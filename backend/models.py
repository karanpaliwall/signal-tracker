from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class SchedulerConfig(BaseModel):
    enabled: bool
    hour: int = Field(default=9, ge=0, le=23)
    minute: int = Field(default=0, ge=0, le=59)


class NotifyConfig(BaseModel):
    enabled: bool
    recipients: list[EmailStr] = []


class SourcesConfig(BaseModel):
    linkedin_enabled: bool = True
    indeed_enabled: bool = True
    glassdoor_enabled: bool = False
    monster_enabled: bool = False
    naukri_enabled: bool = False
    results_per_keyword: int = Field(default=25, ge=1, le=1000)
    linkedin_keywords: list[str] = []
    indeed_keywords: list[str] = []
    glassdoor_keywords: list[str] = []
    monster_keywords: list[str] = []
    naukri_keywords: list[str] = []


class DeleteSignalsRequest(BaseModel):
    ids: list[UUID] = Field(..., max_length=500)
