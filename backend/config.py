from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql://tbs_user:tbs_secure_2024@localhost:5432/tbs_marketing"
    
    # Google OAuth
    GOOGLE_CLIENT_ID: str
    GOOGLE_CLIENT_SECRET: str
    
    # JWT
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    
    # API Keys (Optional)
    OPENAI_API_KEY: str = ""
    # Image model for AI-deck photos. Override per-environment if an account lacks
    # the default; image_service falls back to gpt-image-1 on model-availability errors.
    OPENAI_IMAGE_MODEL: str = "gpt-image-2"
    ANTHROPIC_API_KEY: str = ""
    GROQ_API_KEY: str = ""
    DEEPSEEK_API_KEY: str = ""
    SERPAPI_KEY: str = ""
    FIRECRAWL_API_KEY: str = ""
    SERANKING_API_KEY: str = ""  # SE Ranking Project API — TBS's account key (API > Dashboard)
    SLIDESPEAK_API_KEY: str = ""  # SlideSpeak API — AI presentation generation (slidespeak.co)

    # Additional provider keys (optional)
    QWEN_API_KEY: str = ""        # Alibaba Qwen
    KIMI_API_KEY: str = ""        # Moonshot Kimi
    BYTEDANCE_API_KEY: str = ""   # ByteDance / Doubao
    REPLICATE_API_KEY: str = ""   # Replicate
    XAI_API_KEY: str = ""         # xAI (Grok)
    MINIMAX_API_KEY: str = ""     # MiniMax
    PEXELS_API_KEY: str = ""      # Pexels stock images
    PIXABAY_API_KEY: str = ""     # Pixabay stock images
    
    # App Settings
    ENVIRONMENT: str = "development"
    ALLOWED_ORIGINS: str = (
        "http://localhost:5173,http://localhost:3000,"
        "https://analysis.phyominthein.com,https://analysis.phyominthein.com/,"
        "https://api.phyominthein.com,https://api.phyominthein.com/"
    )
    
    @property
    def allowed_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",")]
    
    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
