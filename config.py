import os


def get_required(key: str) -> str:
    value = os.environ.get(key)
    if not value:
        raise EnvironmentError(f"Required environment variable '{key}' is not set.")
    return value


def get_optional(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


ANTHROPIC_API_KEY: str = get_optional("ANTHROPIC_API_KEY")
GOOGLE_SERVICE_ACCOUNT_JSON: str = get_optional("GOOGLE_SERVICE_ACCOUNT_JSON")
DRIVE_FOLDER_ID: str = get_optional("DRIVE_FOLDER_ID", "18wtkPzESM12OZhe4e2YLQ5mT1HhBVGw0")
AFFILIATE_LINK: str = get_optional("AFFILIATE_LINK", "https://amzn.to/kessan_class")
DRIVE_FOLDER_URL: str = get_optional(
    "DRIVE_FOLDER_URL",
    f"https://drive.google.com/drive/folders/{get_optional('DRIVE_FOLDER_ID', '18wtkPzESM12OZhe4e2YLQ5mT1HhBVGw0')}",
)

MODEL = "claude-sonnet-4-6"
TDNET_BASE_URL = "https://www.release.tdnet.info/inbs/I_main_00.html"
TDNET_SEARCH_URL = "https://www.release.tdnet.info/inbs/I_main_00.html"
