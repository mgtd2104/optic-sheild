"""
Cryptographic Utilities for Optic Shield Backend

AES-256-GCM encryption/decryption for low-bandwidth payload encryption,
SHA-256 hashing for audit ledger, key derivation, and secure configuration.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time
from dataclasses import dataclass
from typing import Any, Optional

from cryptography.hazmat.primitives import hashes, hmac as crypto_hmac
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from pydantic import BaseModel, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class SecuritySettings(BaseSettings):
    """Security configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Master encryption key (32 bytes = 256 bits)
    # In production, this should be loaded from a secure key management system (HSM, Vault, AWS KMS)
    MASTER_ENCRYPTION_KEY: SecretStr = Field(
        default=...,
        description="Base64-encoded 32-byte master key for AES-256-GCM",
    )

    # Key derivation salt (16 bytes)
    KEY_DERIVATION_SALT: SecretStr = Field(
        default=...,
        description="Base64-encoded 16-byte salt for HKDF/PBKDF2",
    )

    # JWT settings
    JWT_SECRET_KEY: SecretStr = Field(
        default=...,
        description="Secret key for JWT signing (HS256)",
    )
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_MINUTES: int = 30
    JWT_REFRESH_EXPIRATION_DAYS: int = 7

    # AES-256-GCM settings
    AES_KEY_SIZE: int = 32  # bytes
    AES_NONCE_SIZE: int = 12  # bytes (96-bit for GCM)
    AES_TAG_SIZE: int = 16  # bytes

    # HMAC settings
    HMAC_KEY_SIZE: int = 32
    HMAC_ALGORITHM: str = "SHA256"

    # Key rotation
    KEY_ROTATION_INTERVAL_DAYS: int = 90
    MAX_KEY_VERSIONS: int = 5

    # Audit ledger
    LEDGER_HASH_ALGORITHM: str = "SHA256"
    LEDGER_BLOCK_INTERVAL_SECONDS: int = 60

    # TLS
    TLS_CERT_PATH: Optional[str] = None
    TLS_KEY_PATH: Optional[str] = None
    TLS_CA_PATH: Optional[str] = None

    def get_master_key_bytes(self) -> bytes:
        """Decode master key from base64."""
        key_b64 = self.MASTER_ENCRYPTION_KEY.get_secret_value()
        key_bytes = base64.b64decode(key_b64)
        if len(key_bytes) != self.AES_KEY_SIZE:
            raise ValueError(f"Master key must be {self.AES_KEY_SIZE} bytes (got {len(key_bytes)})")
        return key_bytes

    def get_salt_bytes(self) -> bytes:
        """Decode salt from base64."""
        salt_b64 = self.KEY_DERIVATION_SALT.get_secret_value()
        salt_bytes = base64.b64decode(salt_b64)
        if len(salt_bytes) != 16:
            raise ValueError(f"Salt must be 16 bytes (got {len(salt_bytes)})")
        return salt_bytes


@dataclass(frozen=True, slots=True)
class EncryptedPayload:
    """Encrypted payload container with metadata."""

    ciphertext: bytes
    nonce: bytes
    tag: bytes
    key_version: int
    timestamp: float
    associated_data: Optional[bytes] = None

    def to_bytes(self) -> bytes:
        """Serialize to wire format: version(1) | timestamp(8) | nonce(12) | tag(16) | ciphertext | ad_len(2) | ad"""
        import struct
        ad = self.associated_data or b""
        ad_len = struct.pack(">H", len(ad))
        version = struct.pack(">B", self.key_version)
        timestamp = struct.pack(">Q", int(self.timestamp * 1000))  # milliseconds
        return version + timestamp + self.nonce + self.tag + self.ciphertext + ad_len + ad

    @classmethod
    def from_bytes(cls, data: bytes) -> "EncryptedPayload":
        """Deserialize from wire format."""
        import struct
        if len(data) < 1 + 8 + 12 + 16 + 2:
            raise ValueError("Invalid encrypted payload format")

        version = struct.unpack(">B", data[0:1])[0]
        timestamp_ms = struct.unpack(">Q", data[1:9])[0]
        timestamp = timestamp_ms / 1000.0
        nonce = data[9:21]
        tag = data[21:37]
        ad_len = struct.unpack(">H", data[-2:])[0]
        ciphertext = data[37:-2-ad_len]
        associated_data = data[-ad_len:] if ad_len > 0 else None
        return cls(
            ciphertext=ciphertext,
            nonce=nonce,
            tag=tag,
            key_version=version,
            timestamp=timestamp,
            associated_data=associated_data,
        )

    def to_base64(self) -> str:
        """Encode as base64 string for JSON transport."""
        return base64.b64encode(self.to_bytes()).decode("ascii")

    @classmethod
    def from_base64(cls, b64: str) -> "EncryptedPayload":
        """Decode from base64 string."""
        return cls.from_bytes(base64.b64decode(b64))


class AES256GCMCipher:
    """
    AES-256-GCM authenticated encryption for payload protection.

    Uses cryptography.hazmat for constant-time operations.
    """

    def __init__(self, key: bytes) -> None:
        """
        Initialize cipher with 32-byte key.

        Args:
            key: 32-byte (256-bit) encryption key.
        """
        if len(key) != 32:
            raise ValueError("AES-256 requires 32-byte key")
        self._key = key
        self._aesgcm = AESGCM(key)

    def encrypt(
        self,
        plaintext: bytes,
        associated_data: Optional[bytes] = None,
        nonce: Optional[bytes] = None,
    ) -> EncryptedPayload:
        """
        Encrypt plaintext with AES-256-GCM.

        Args:
            plaintext: Data to encrypt.
            associated_data: Additional authenticated data (AAD) - not encrypted but authenticated.
            nonce: Optional 12-byte nonce (generated randomly if not provided).

        Returns:
            EncryptedPayload with ciphertext, nonce, tag, and metadata.
        """
        if nonce is None:
            nonce = secrets.token_bytes(12)
        elif len(nonce) != 12:
            raise ValueError("Nonce must be 12 bytes for AES-GCM")

        # Encrypt: returns ciphertext + tag concatenated
        ciphertext_with_tag = self._aesgcm.encrypt(nonce, plaintext, associated_data)

        # Split ciphertext and tag (tag is last 16 bytes)
        ciphertext = ciphertext_with_tag[:-16]
        tag = ciphertext_with_tag[-16:]

        return EncryptedPayload(
            ciphertext=ciphertext,
            nonce=nonce,
            tag=tag,
            key_version=1,  # Current key version
            timestamp=time.time(),
            associated_data=associated_data,
        )

    def decrypt(self, payload: EncryptedPayload) -> bytes:
        """
        Decrypt and verify payload.

        Args:
            payload: EncryptedPayload to decrypt.

        Returns:
            Decrypted plaintext.

        Raises:
            cryptography.exceptions.InvalidTag: If authentication fails.
        """
        # Reconstruct ciphertext+tag for decrypt
        ciphertext_with_tag = payload.ciphertext + payload.tag
        return self._aesgcm.decrypt(
            payload.nonce,
            ciphertext_with_tag,
            payload.associated_data,
        )

    def encrypt_json(self, data: dict[str, Any], associated_data: Optional[bytes] = None) -> EncryptedPayload:
        """Encrypt JSON-serializable data."""
        import json
        plaintext = json.dumps(data, separators=(",", ":"), sort_keys=True).encode("utf-8")
        return self.encrypt(plaintext, associated_data)

    def decrypt_json(self, payload: EncryptedPayload) -> dict[str, Any]:
        """Decrypt and parse JSON."""
        import json
        plaintext = self.decrypt(payload)
        return json.loads(plaintext.decode("utf-8"))


class KeyManager:
    """
    Key derivation and rotation management.

    Uses HKDF for deriving per-purpose keys from master key.
    """

    def __init__(self, settings: SecuritySettings) -> None:
        self.settings = settings
        self._master_key = settings.get_master_key_bytes()
        self._salt = settings.get_salt_bytes()
        self._key_cache: dict[str, bytes] = {}
        self._key_versions: dict[int, bytes] = {1: self._master_key}

    def derive_key(self, purpose: str, key_length: int = 32, version: int = 1) -> bytes:
        """
        Derive a purpose-specific key from master key using HKDF.

        Args:
            purpose: Key purpose identifier (e.g., "payload_encryption", "jwt_signing").
            key_length: Desired key length in bytes.
            version: Key version to derive from.

        Returns:
            Derived key bytes.
        """
        cache_key = f"{purpose}:{version}:{key_length}"
        if cache_key in self._key_cache:
            return self._key_cache[cache_key]

        base_key = self._key_versions.get(version, self._master_key)

        hkdf = HKDF(
            algorithm=hashes.SHA256(),
            length=key_length,
            salt=self._salt,
            info=purpose.encode("utf-8"),
        )
        derived = hkdf.derive(base_key)
        self._key_cache[cache_key] = derived
        return derived

    def get_payload_cipher(self, version: int = 1) -> AES256GCMCipher:
        """Get AES-256-GCM cipher for payload encryption."""
        key = self.derive_key("payload_encryption", 32, version)
        return AES256GCMCipher(key)

    def get_hmac_key(self, version: int = 1) -> bytes:
        """Get HMAC key for message authentication."""
        return self.derive_key("hmac_authentication", self.settings.HMAC_KEY_SIZE, version)

    def rotate_keys(self) -> int:
        """
        Generate new key version.

        Returns:
            New key version number.
        """
        new_version = max(self._key_versions.keys()) + 1
        # In production, this would generate a new master key and store old versions securely
        # For now, derive from current master with version info
        new_key = self.derive_key(f"master_v{new_version}", 32)
        self._key_versions[new_version] = new_key

        # Cleanup old versions beyond max
        if len(self._key_versions) > self.settings.MAX_KEY_VERSIONS:
            oldest = min(self._key_versions.keys())
            if oldest != 1:  # Keep version 1
                del self._key_versions[oldest]

        return new_version


class SHA256Hasher:
    """SHA-256 utilities for audit ledger and integrity verification."""

    @staticmethod
    def hash_data(data: bytes) -> bytes:
        """Compute SHA-256 hash of data."""
        return hashlib.sha256(data).digest()

    @staticmethod
    def hash_data_hex(data: bytes) -> str:
        """Compute SHA-256 hash as hex string."""
        return hashlib.sha256(data).hexdigest()

    @staticmethod
    def hash_file(path: str, chunk_size: int = 8192) -> str:
        """Compute SHA-256 hash of file."""
        h = hashlib.sha256()
        with open(path, "rb") as f:
            while chunk := f.read(chunk_size):
                h.update(chunk)
        return h.hexdigest()

    @staticmethod
    def hmac_sha256(key: bytes, data: bytes) -> bytes:
        """Compute HMAC-SHA256."""
        return hmac.new(key, data, hashlib.sha256).digest()

    @staticmethod
    def hmac_sha256_hex(key: bytes, data: bytes) -> str:
        """Compute HMAC-SHA256 as hex string."""
        return hmac.new(key, data, hashlib.sha256).hexdigest()

    @staticmethod
    def verify_hmac(key: bytes, data: bytes, expected: bytes) -> bool:
        """Constant-time HMAC verification."""
        return hmac.compare_digest(SHA256Hasher.hmac_sha256(key, data), expected)

    @staticmethod
    def merkle_root(hashes: list[bytes]) -> bytes:
        """
        Compute Merkle root from list of hashes.

        Args:
            hashes: List of 32-byte hashes.

        Returns:
            Merkle root hash.
        """
        if not hashes:
            return b"\x00" * 32

        current_level = hashes[:]
        while len(current_level) > 1:
            next_level = []
            for i in range(0, len(current_level), 2):
                left = current_level[i]
                right = current_level[i + 1] if i + 1 < len(current_level) else left
                combined = left + right
                next_level.append(SHA256Hasher.hash_data(combined))
            current_level = next_level
        return current_level[0]


class TokenManager:
    """JWT token management for authentication."""

    def __init__(self, settings: SecuritySettings) -> None:
        self.settings = settings
        self._secret = settings.JWT_SECRET_KEY.get_secret_value().encode("utf-8")

    def create_access_token(self, subject: str, extra_claims: Optional[dict[str, Any]] = None) -> str:
        """Create JWT access token."""
        import jwt
        now = int(time.time())
        payload = {
            "sub": subject,
            "iat": now,
            "exp": now + self.settings.JWT_EXPIRATION_MINUTES * 60,
            "type": "access",
        }
        if extra_claims:
            payload.update(extra_claims)
        return jwt.encode(payload, self._secret, algorithm=self.settings.JWT_ALGORITHM)

    def create_refresh_token(self, subject: str) -> str:
        """Create JWT refresh token."""
        import jwt
        now = int(time.time())
        payload = {
            "sub": subject,
            "iat": now,
            "exp": now + self.settings.JWT_REFRESH_EXPIRATION_DAYS * 86400,
            "type": "refresh",
        }
        return jwt.encode(payload, self._secret, algorithm=self.settings.JWT_ALGORITHM)

    def decode_token(self, token: str) -> dict[str, Any]:
        """Decode and validate JWT token."""
        import jwt
        try:
            payload = jwt.decode(
                token,
                self._secret,
                algorithms=[self.settings.JWT_ALGORITHM],
            )
            return payload
        except jwt.ExpiredSignatureError:
            raise ValueError("Token expired")
        except jwt.InvalidTokenError as e:
            raise ValueError(f"Invalid token: {e}")

    def verify_token(self, token: str, expected_type: str = "access") -> dict[str, Any]:
        """Verify token and check type."""
        payload = self.decode_token(token)
        if payload.get("type") != expected_type:
            raise ValueError(f"Expected {expected_type} token, got {payload.get('type')}")
        return payload


# High-level convenience functions
def encrypt_payload(
    plaintext: bytes,
    key: Optional[bytes] = None,
    associated_data: Optional[bytes] = None,
    nonce: Optional[bytes] = None,
) -> EncryptedPayload:
    """
    Encrypt payload with AES-256-GCM.

    Args:
        plaintext: Data to encrypt.
        key: 32-byte encryption key (generates random if not provided).
        associated_data: Additional authenticated data.
        nonce: Optional 12-byte nonce.

    Returns:
        EncryptedPayload ready for transport.
    """
    if key is None:
        key = secrets.token_bytes(32)
    cipher = AES256GCMCipher(key)
    return cipher.encrypt(plaintext, associated_data, nonce)


def decrypt_payload(
    payload: EncryptedPayload,
    key: bytes,
) -> bytes:
    """
    Decrypt AES-256-GCM payload.

    Args:
        payload: EncryptedPayload to decrypt.
        key: 32-byte decryption key.

    Returns:
        Decrypted plaintext.
    """
    cipher = AES256GCMCipher(key)
    return cipher.decrypt(payload)


def generate_key_pair() -> tuple[bytes, bytes]:
    """Generate a random 32-byte key and 16-byte salt."""
    return secrets.token_bytes(32), secrets.token_bytes(16)


def generate_api_key(prefix: str = "os_") -> str:
    """Generate a secure API key."""
    return prefix + secrets.token_urlsafe(32)


def constant_time_compare(a: str, b: str) -> bool:
    """Constant-time string comparison."""
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


# Global settings instance (initialized lazily)
_settings: Optional[SecuritySettings] = None
_key_manager: Optional[KeyManager] = None
_token_manager: Optional[TokenManager] = None


def get_settings() -> SecuritySettings:
    """Get global security settings."""
    global _settings
    if _settings is None:
        _settings = SecuritySettings()
    return _settings


def get_key_manager() -> KeyManager:
    """Get global key manager."""
    global _key_manager
    if _key_manager is None:
        _key_manager = KeyManager(get_settings())
    return _key_manager


def get_token_manager() -> TokenManager:
    """Get global token manager."""
    global _token_manager
    if _token_manager is None:
        _token_manager = TokenManager(get_settings())
    return _token_manager


def get_payload_cipher(version: int = 1) -> AES256GCMCipher:
    """Get payload cipher for current key version."""
    return get_key_manager().get_payload_cipher(version)


# Export for convenience
__all__ = [
    "SecuritySettings",
    "EncryptedPayload",
    "AES256GCMCipher",
    "KeyManager",
    "SHA256Hasher",
    "TokenManager",
    "encrypt_payload",
    "decrypt_payload",
    "generate_key_pair",
    "generate_api_key",
    "constant_time_compare",
    "get_settings",
    "get_key_manager",
    "get_token_manager",
    "get_payload_cipher",
]


if __name__ == "__main__":
    # Demo / self-test
    import json

    # Generate test key and salt
    key, salt = generate_key_pair()
    print(f"Generated key: {base64.b64encode(key).decode()}")
    print(f"Generated salt: {base64.b64encode(salt).decode()}")

    # Test encryption
    test_data = {"camera_id": "cam_01", "alert": "INTRUSION", "confidence": 0.95}
    plaintext = json.dumps(test_data).encode()

    payload = encrypt_payload(plaintext, key)
    print(f"Encrypted: {payload.to_base64()[:100]}...")

    decrypted = decrypt_payload(payload, key)
    print(f"Decrypted: {decrypted.decode()}")

    # Test SHA256
    h = SHA256Hasher.hash_data_hex(b"test")
    print(f"SHA256('test'): {h}")

    # Test Merkle root
    hashes = [SHA256Hasher.hash_data(f"tx{i}".encode()) for i in range(4)]
    root = SHA256Hasher.merkle_root(hashes)
    print(f"Merkle root: {root.hex()}")

    # Test key derivation
    km = KeyManager(SecuritySettings(
        MASTER_ENCRYPTION_KEY=SecretStr(base64.b64encode(key).decode()),
        KEY_DERIVATION_SALT=SecretStr(base64.b64encode(salt).decode()),
        JWT_SECRET_KEY=SecretStr("test-secret"),
    ))
    derived = km.derive_key("test_purpose")
    print(f"Derived key: {base64.b64encode(derived).decode()}")