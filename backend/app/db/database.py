"""
Database Configuration & Async SQLAlchemy 2.0 Engine

Supports SQLite (development/edge) and PostgreSQL (production) with
connection pooling, migration utilities, and session management.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Optional

from sqlalchemy import MetaData, Pool, event, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool, QueuePool

from backend.app.core.security import get_settings

logger = logging.getLogger(__name__)


# Naming convention for constraints (Alembic-friendly)
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

metadata = MetaData(naming_convention=NAMING_CONVENTION)


class Base(DeclarativeBase):
    """Base class for all ORM models."""

    metadata = metadata

    def to_dict(self) -> dict[str, Any]:
        """Convert model to dictionary."""
        return {c.name: getattr(self, c.name) for c in self.__table__.columns}

    def __repr__(self) -> str:
        cols = ", ".join(f"{c.name}={getattr(self, c.name)!r}" for c in self.__table__.columns)
        return f"{self.__class__.__name__}({cols})"


@dataclass(frozen=True, slots=True)
class DatabaseConfig:
    """Database configuration."""

    # Connection URLs
    sqlite_url: str = "sqlite+aiosqlite:///./optic_shield.db"
    postgresql_url: str = "postgresql+asyncpg://user:pass@localhost:5432/optic_shield"

    # Environment
    environment: str = "development"  # "development", "testing", "production"

    # Pool settings (PostgreSQL)
    pool_size: int = 10
    max_overflow: int = 20
    pool_timeout: float = 30.0
    pool_recycle: int = 3600  # seconds
    pool_pre_ping: bool = True

    # SQLite settings
    sqlite_pragma_foreign_keys: bool = True
    sqlite_pragma_journal_mode: str = "WAL"
    sqlite_pragma_synchronous: str = "NORMAL"
    sqlite_pragma_cache_size: int = -32768  # 32MB

    # Migration
    alembic_config_path: str = "alembic.ini"
    migrations_dir: str = "migrations"

    # Performance
    echo_sql: bool = False
    echo_pool: bool = False


class DatabaseManager:
    """
    Manages async database engine and sessions.

    Provides factory for creating engines and sessions for different environments.
    """

    def __init__(self, config: Optional[DatabaseConfig] = None) -> None:
        self.config = config or DatabaseConfig()
        self._engine: Optional[AsyncEngine] = None
        self._session_factory: Optional[async_sessionmaker[AsyncSession]] = None
        self._initialized = False

    @property
    def engine(self) -> AsyncEngine:
        """Get or create async engine."""
        if self._engine is None:
            raise RuntimeError("Database not initialized. Call initialize() first.")
        return self._engine

    @property
    def session_factory(self) -> async_sessionmaker[AsyncSession]:
        """Get session factory."""
        if self._session_factory is None:
            raise RuntimeError("Database not initialized. Call initialize() first.")
        return self._session_factory

    def initialize(self, url: Optional[str] = None) -> None:
        """
        Initialize database engine and session factory.

        Args:
            url: Optional database URL override.
        """
        if self._initialized:
            logger.warning("Database already initialized")
            return

        db_url = url or self._get_database_url()
        logger.info("Initializing database: %s", db_url)

        # Create engine based on dialect
        if db_url.startswith("sqlite"):
            self._engine = self._create_sqlite_engine(db_url)
        elif db_url.startswith("postgresql"):
            self._engine = self._create_postgresql_engine(db_url)
        else:
            raise ValueError(f"Unsupported database URL: {db_url}")

        # Create session factory
        self._session_factory = async_sessionmaker(
            bind=self._engine,
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
        )

        # Setup event listeners
        self._setup_event_listeners()

        self._initialized = True
        logger.info("Database initialized successfully")

    def _get_database_url(self) -> str:
        """Get database URL based on environment."""
        import os
        # Check environment variable first
        env_url = os.getenv("DATABASE_URL")
        if env_url:
            return env_url

        if self.config.environment == "production":
            return self.config.postgresql_url
        return self.config.sqlite_url

    def _create_sqlite_engine(self, url: str) -> AsyncEngine:
        """Create SQLite async engine with optimizations."""
        engine = create_async_engine(
            url,
            echo=self.config.echo_sql,
            echo_pool=self.config.echo_pool,
            poolclass=NullPool,  # SQLite doesn't support connection pooling well
            connect_args={
                "check_same_thread": False,
            },
        )

        @event.listens_for(engine.sync_engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            if self.config.sqlite_pragma_foreign_keys:
                cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute(f"PRAGMA journal_mode={self.config.sqlite_pragma_journal_mode}")
            cursor.execute(f"PRAGMA synchronous={self.config.sqlite_pragma_synchronous}")
            cursor.execute(f"PRAGMA cache_size={self.config.sqlite_pragma_cache_size}")
            cursor.close()

        return engine

    def _create_postgresql_engine(self, url: str) -> AsyncEngine:
        """Create PostgreSQL async engine with connection pooling."""
        return create_async_engine(
            url,
            echo=self.config.echo_sql,
            echo_pool=self.config.echo_pool,
            poolclass=QueuePool,
            pool_size=self.config.pool_size,
            max_overflow=self.config.max_overflow,
            pool_timeout=self.config.pool_timeout,
            pool_recycle=self.config.pool_recycle,
            pool_pre_ping=self.config.pool_pre_ping,
        )

    def _setup_event_listeners(self) -> None:
        """Setup SQLAlchemy event listeners."""

        @event.listens_for(self._engine.sync_engine, "before_cursor_execute")
        def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
            conn.info.setdefault("query_start_time", []).append(time.time())

        @event.listens_for(self._engine.sync_engine, "after_cursor_execute")
        def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
            import time
            total = time.time() - conn.info["query_start_time"].pop(-1)
            if total > 1.0:  # Log slow queries (>1s)
                logger.warning("Slow query (%.3fs): %s", total, statement[:200])

    async def create_tables(self) -> None:
        """Create all tables (development only)."""
        if self.config.environment == "production":
            raise RuntimeError("create_tables() not allowed in production. Use migrations.")
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Tables created")

    async def drop_tables(self) -> None:
        """Drop all tables (development only)."""
        if self.config.environment == "production":
            raise RuntimeError("drop_tables() not allowed in production.")
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        logger.info("Tables dropped")

    async def close(self) -> None:
        """Close database connections."""
        if self._engine:
            await self._engine.dispose()
            self._engine = None
            self._session_factory = None
            self._initialized = False
            logger.info("Database connections closed")

    @asynccontextmanager
    async def session(self) -> AsyncGenerator[AsyncSession, None]:
        """
        Get database session with automatic commit/rollback.

        Usage:
            async with db_manager.session() as session:
                session.add(obj)
                await session.commit()
        """
        if not self._initialized:
            self.initialize()

        async with self._session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()

    @asynccontextmanager
    async def transaction(self) -> AsyncGenerator[AsyncSession, None]:
        """
        Get session with explicit transaction control.

        Usage:
            async with db_manager.transaction() as session:
                session.add(obj)
                # commit/rollback handled manually or on exception
        """
        if not self._initialized:
            self.initialize()

        async with self._session_factory() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()

    async def health_check(self) -> bool:
        """Check database connectivity."""
        try:
            async with self.session() as session:
                await session.execute(text("SELECT 1"))
            return True
        except Exception as e:
            logger.error("Database health check failed: %s", e)
            return False

    async def get_pool_status(self) -> dict[str, Any]:
        """Get connection pool status."""
        if not self._engine:
            return {"status": "not_initialized"}

        pool: Pool = self._engine.pool
        return {
            "pool_size": pool.size(),
            "checked_in": pool.checkedin(),
            "checked_out": pool.checkedout(),
            "overflow": pool.overflow(),
            "invalid": pool.invalidated(),
        }


# Global database manager instance
_db_manager: Optional[DatabaseManager] = None


def get_database_manager(config: Optional[DatabaseConfig] = None) -> DatabaseManager:
    """Get or create global database manager."""
    global _db_manager
    if _db_manager is None:
        _db_manager = DatabaseManager(config)
    return _db_manager


def init_database(config: Optional[DatabaseConfig] = None, url: Optional[str] = None) -> DatabaseManager:
    """Initialize global database manager."""
    global _db_manager
    _db_manager = DatabaseManager(config)
    _db_manager.initialize(url)
    return _db_manager


async def close_database() -> None:
    """Close global database connections."""
    global _db_manager
    if _db_manager:
        await _db_manager.close()
        _db_manager = None


# FastAPI dependency
async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency for database session.

    Usage:
        @app.get("/items")
        async def get_items(session: AsyncSession = Depends(get_db_session)):
            ...
    """
    db_manager = get_database_manager()
    async with db_manager.session() as session:
        yield session


# Migration utilities
def run_migrations(alembic_config_path: Optional[str] = None) -> None:
    """Run Alembic migrations."""
    from alembic import command
    from alembic.config import Config

    config_path = alembic_config_path or get_database_manager().config.alembic_config_path
    alembic_cfg = Config(config_path)
    command.upgrade(alembic_cfg, "head")
    logger.info("Migrations applied")


def create_migration(message: str, alembic_config_path: Optional[str] = None) -> None:
    """Create new Alembic migration."""
    from alembic import command
    from alembic.config import Config

    config_path = alembic_config_path or get_database_manager().config.alembic_config_path
    alembic_cfg = Config(config_path)
    command.revision(alembic_cfg, message=message, autogenerate=True)
    logger.info("Migration created: %s", message)


def get_current_revision(alembic_config_path: Optional[str] = None) -> str:
    """Get current Alembic revision."""
    from alembic import script
    from alembic.config import Config

    config_path = alembic_config_path or get_database_manager().config.alembic_config_path
    alembic_cfg = Config(config_path)
    script_dir = script.ScriptDirectory.from_config(alembic_cfg)
    return script_dir.get_current_head()


# Import time for event listeners
import time


if __name__ == "__main__":
    # Demo / self-test
    import asyncio

    async def test():
        db = init_database(DatabaseConfig(environment="development"))
        await db.create_tables()

        async with db.session() as session:
            result = await session.execute(text("SELECT 1 as test"))
            print(f"Health check: {result.scalar()}")

        print(f"Pool status: {await db.get_pool_status()}")
        await db.close()

    asyncio.run(test())