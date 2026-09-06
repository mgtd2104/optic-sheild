"""
Zero-DCE Low-Light Image Enhancement Preprocessor

Auto-triggered enhancement for low-light frames using Zero-DCE (Zero-Reference Deep Curve Estimation) logic.
Operates entirely in-memory on numpy arrays without disk I/O.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class EnhancementConfig:
    """Configuration for Zero-DCE enhancement triggering and parameters."""

    luminance_threshold: float = 85.0  # Mean luminance (0-255) below which enhancement triggers
    histogram_low_ratio: float = 0.4  # Ratio of pixels in lower 25% intensity bins to trigger
    curve_iterations: int = 8  # Number of curve estimation iterations (Zero-DCE default)
    gamma_correction: float = 1.2  # Gamma correction factor for final output
    max_enhancement_factor: float = 3.0  # Maximum allowed enhancement multiplier
    clip_limit: float = 2.0  # CLAHE clip limit for local contrast
    tile_grid_size: tuple[int, int] = (8, 8)  # CLAHE tile grid size


@dataclass(frozen=True, slots=True)
class EnhancementResult:
    """Result of the enhancement operation."""

    enhanced: bool
    original_luminance: float
    enhanced_luminance: float
    enhancement_factor: float
    processing_time_ms: float
    frame: np.ndarray


class ZeroDCEEnhancer:
    """
    Zero-Reference Deep Curve Estimation (Zero-DCE) inspired low-light enhancer.

    This implementation uses a lightweight, deterministic curve estimation approach
    inspired by Zero-DCE but without requiring a trained neural network model.
    It calculates frame statistics and applies adaptive curve-based enhancement
    when low-light conditions are detected.

    All operations are in-memory on numpy arrays.
    """

    def __init__(self, config: Optional[EnhancementConfig] = None) -> None:
        """
        Initialize the Zero-DCE enhancer.

        Args:
            config: EnhancementConfig with thresholds and parameters.
                    Uses defaults if not provided.
        """
        self.config = config or EnhancementConfig()
        self._clahe = cv2.createCLAHE(
            clipLimit=self.config.clip_limit,
            tileGridSize=self.config.tile_grid_size,
        )
        logger.info(
            "ZeroDCEEnhancer initialized with luminance_threshold=%.1f, "
            "histogram_low_ratio=%.2f",
            self.config.luminance_threshold,
            self.config.histogram_low_ratio,
        )

    def _calculate_luminance(self, frame: np.ndarray) -> float:
        """
        Calculate mean luminance of a frame.

        Args:
            frame: Input frame as numpy array (H, W, 3) BGR or (H, W) grayscale.

        Returns:
            Mean luminance value in range [0, 255].
        """
        if frame.ndim == 3:
            # Convert BGR to grayscale using standard luminance weights
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        else:
            gray = frame
        return float(np.mean(gray))

    def _calculate_histogram_low_ratio(self, frame: np.ndarray) -> float:
        """
        Calculate ratio of pixels in the lowest 25% intensity bins.

        Args:
            frame: Input frame as numpy array (H, W, 3) BGR or (H, W) grayscale.

        Returns:
            Ratio of pixels in lower 25% intensity range (0-63).
        """
        if frame.ndim == 3:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        else:
            gray = frame

        hist = cv2.calcHist([gray], [0], None, [256], [0, 256])
        total_pixels = gray.size
        low_pixels = float(np.sum(hist[:64]))  # Bins 0-63 (lower 25%)
        return low_pixels / total_pixels if total_pixels > 0 else 0.0

    def _should_enhance(self, frame: np.ndarray) -> tuple[bool, float, float]:
        """
        Determine if frame needs enhancement based on luminance and histogram.

        Args:
            frame: Input frame as numpy array.

        Returns:
            Tuple of (should_enhance, mean_luminance, histogram_low_ratio).
        """
        mean_lum = self._calculate_luminance(frame)
        hist_low_ratio = self._calculate_histogram_low_ratio(frame)

        should_enhance = (
            mean_lum < self.config.luminance_threshold
            or hist_low_ratio > self.config.histogram_low_ratio
        )

        return should_enhance, mean_lum, hist_low_ratio

    def _estimate_curve(self, frame: np.ndarray) -> np.ndarray:
        """
        Estimate the enhancement curve using iterative refinement (Zero-DCE style).

        This implements a simplified version of the Zero-DCE curve estimation
        using adaptive gamma correction based on local statistics.

        Args:
            frame: Normalized input frame in range [0, 1], shape (H, W, 3) or (H, W).

        Returns:
            Enhancement curve map of same shape as input, values in [0, 1].
        """
        # Normalize to [0, 1] if not already
        if frame.max() > 1.0:
            frame_norm = frame.astype(np.float32) / 255.0
        else:
            frame_norm = frame.astype(np.float32)

        # Initial curve estimate: identity
        curve = np.ones_like(frame_norm, dtype=np.float32)

        # Iterative refinement based on local mean
        for _ in range(self.config.curve_iterations):
            # Local mean using box filter (fast approximation)
            if frame_norm.ndim == 3:
                local_mean = cv2.boxFilter(frame_norm, -1, (3, 3))
            else:
                local_mean = cv2.boxFilter(frame_norm, -1, (3, 3))

            # Curve update: boost dark regions, preserve bright regions
            # Using the formulation: curve = curve * (1 + alpha * (1 - local_mean))
            alpha = 0.5  # Enhancement strength
            curve = curve * (1.0 + alpha * (1.0 - local_mean))

            # Clamp to reasonable range
            curve = np.clip(curve, 0.1, self.config.max_enhancement_factor)

        return curve

    def _apply_curve(self, frame: np.ndarray, curve: np.ndarray) -> np.ndarray:
        """
        Apply the estimated curve to enhance the frame.

        Args:
            frame: Input frame in range [0, 255], uint8.
            curve: Enhancement curve of same shape, values as multipliers.

        Returns:
            Enhanced frame as uint8 numpy array.
        """
        frame_float = frame.astype(np.float32) / 255.0

        # Apply curve: enhanced = frame^curve (gamma-style) or frame * curve
        # Zero-DCE uses: enhanced = frame + curve * (frame - frame^2)
        # We use a simplified but effective formulation:
        enhanced = frame_float * curve

        # Apply gamma correction for perceptual brightness
        if self.config.gamma_correction != 1.0:
            enhanced = np.power(enhanced, 1.0 / self.config.gamma_correction)

        # Clip and convert back to uint8
        enhanced = np.clip(enhanced * 255.0, 0, 255).astype(np.uint8)
        return enhanced

    def _apply_clahe(self, frame: np.ndarray) -> np.ndarray:
        """
        Apply CLAHE (Contrast Limited Adaptive Histogram Equalization) for local contrast.

        Args:
            frame: Input frame as uint8 numpy array (H, W, 3) BGR or (H, W) grayscale.

        Returns:
            CLAHE-enhanced frame.
        """
        if frame.ndim == 3:
            # Apply CLAHE to L channel in LAB space
            lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            l_enhanced = self._clahe.apply(l)
            lab_enhanced = cv2.merge([l_enhanced, a, b])
            return cv2.cvtColor(lab_enhanced, cv2.COLOR_LAB2BGR)
        else:
            return self._clahe.apply(frame)

    def enhance(self, frame: np.ndarray) -> EnhancementResult:
        """
        Enhance a low-light frame if needed.

        Args:
            frame: Input frame as numpy array (H, W, 3) BGR or (H, W) grayscale, uint8.

        Returns:
            EnhancementResult with enhanced frame and metadata.
        """
        import time

        start_time = time.perf_counter()

        # Validate input
        if frame is None or frame.size == 0:
            raise ValueError("Input frame is empty or None")
        if frame.dtype != np.uint8:
            raise TypeError(f"Expected uint8 frame, got {frame.dtype}")

        # Check if enhancement is needed
        should_enhance, orig_lum, hist_low_ratio = self._should_enhance(frame)

        if not should_enhance:
            processing_time = (time.perf_counter() - start_time) * 1000
            logger.debug(
                "Frame luminance %.1f >= threshold %.1f, hist_low_ratio %.3f <= %.3f. "
                "No enhancement needed.",
                orig_lum,
                self.config.luminance_threshold,
                hist_low_ratio,
                self.config.histogram_low_ratio,
            )
            return EnhancementResult(
                enhanced=False,
                original_luminance=orig_lum,
                enhanced_luminance=orig_lum,
                enhancement_factor=1.0,
                processing_time_ms=processing_time,
                frame=frame.copy(),
            )

        logger.info(
            "Low-light detected: luminance=%.1f (threshold=%.1f), "
            "hist_low_ratio=%.3f (threshold=%.3f). Applying enhancement.",
            orig_lum,
            self.config.luminance_threshold,
            hist_low_ratio,
            self.config.histogram_low_ratio,
        )

        # Apply Zero-DCE style curve estimation
        curve = self._estimate_curve(frame)
        enhanced_frame = self._apply_curve(frame, curve)

        # Apply CLAHE for local contrast improvement
        enhanced_frame = self._apply_clahe(enhanced_frame)

        enhanced_lum = self._calculate_luminance(enhanced_frame)
        enhancement_factor = enhanced_lum / orig_lum if orig_lum > 0 else 1.0
        processing_time = (time.perf_counter() - start_time) * 1000

        logger.info(
            "Enhancement complete: luminance %.1f -> %.1f (factor=%.2fx), "
            "time=%.1fms",
            orig_lum,
            enhanced_lum,
            enhancement_factor,
            processing_time,
        )

        return EnhancementResult(
            enhanced=True,
            original_luminance=orig_lum,
            enhanced_luminance=enhanced_lum,
            enhancement_factor=enhancement_factor,
            processing_time_ms=processing_time,
            frame=enhanced_frame,
        )

    def enhance_batch(self, frames: list[np.ndarray]) -> list[EnhancementResult]:
        """
        Enhance a batch of frames.

        Args:
            frames: List of input frames as numpy arrays.

        Returns:
            List of EnhancementResult objects.
        """
        return [self.enhance(frame) for frame in frames]

    def __call__(self, frame: np.ndarray) -> np.ndarray:
        """
        Convenience callable interface returning only the enhanced frame.

        Args:
            frame: Input frame as numpy array.

        Returns:
            Enhanced frame (or original if no enhancement needed).
        """
        result = self.enhance(frame)
        return result.frame


def create_zerodce_enhancer(
    luminance_threshold: float = 85.0,
    histogram_low_ratio: float = 0.4,
    curve_iterations: int = 8,
    gamma_correction: float = 1.2,
    max_enhancement_factor: float = 3.0,
    clip_limit: float = 2.0,
    tile_grid_size: tuple[int, int] = (8, 8),
) -> ZeroDCEEnhancer:
    """
    Factory function to create a ZeroDCEEnhancer with custom configuration.

    Args:
        luminance_threshold: Mean luminance threshold (0-255) for triggering enhancement.
        histogram_low_ratio: Ratio of dark pixels threshold for triggering.
        curve_iterations: Number of curve estimation iterations.
        gamma_correction: Gamma correction factor.
        max_enhancement_factor: Maximum enhancement multiplier.
        clip_limit: CLAHE clip limit.
        tile_grid_size: CLAHE tile grid size.

    Returns:
        Configured ZeroDCEEnhancer instance.
    """
    config = EnhancementConfig(
        luminance_threshold=luminance_threshold,
        histogram_low_ratio=histogram_low_ratio,
        curve_iterations=curve_iterations,
        gamma_correction=gamma_correction,
        max_enhancement_factor=max_enhancement_factor,
        clip_limit=clip_limit,
        tile_grid_size=tile_grid_size,
    )
    return ZeroDCEEnhancer(config)


if __name__ == "__main__":
    # Demo / self-test
    logging.basicConfig(level=logging.INFO)

    # Create synthetic low-light frame
    h, w = 480, 640
    dark_frame = np.random.randint(0, 50, (h, w, 3), dtype=np.uint8)

    enhancer = create_zerodce_enhancer()
    result = enhancer.enhance(dark_frame)

    print(f"Enhanced: {result.enhanced}")
    print(f"Original luminance: {result.original_luminance:.1f}")
    print(f"Enhanced luminance: {result.enhanced_luminance:.1f}")
    print(f"Enhancement factor: {result.enhancement_factor:.2f}x")
    print(f"Processing time: {result.processing_time_ms:.1f}ms")

    # Test with normal frame
    normal_frame = np.random.randint(100, 200, (h, w, 3), dtype=np.uint8)
    result2 = enhancer.enhance(normal_frame)
    print(f"\nNormal frame enhanced: {result2.enhanced}")