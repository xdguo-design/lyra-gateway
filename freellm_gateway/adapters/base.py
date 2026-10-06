from dataclasses import dataclass


@dataclass
class ProviderError(Exception):
    kind: str
    status_code: int
    detail: str = ""
    retriable: bool = True
    retry_after: float | None = None
    safe_to_retry: bool = False

    def __str__(self) -> str:
        return self.detail or self.kind
