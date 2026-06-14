import os

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
GOOGLE_SERVICE_ACCOUNT_JSON = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")
DRIVE_FOLDER_ID = os.environ.get("DRIVE_FOLDER_ID", "18wtkPzESM12OZhe4e2YLQ5mT1HhBVGw0")
AFFILIATE_LINK = os.environ.get("AFFILIATE_LINK", "https://amzn.to/kessan_class")
DRIVE_FOLDER_URL = os.environ.get("DRIVE_FOLDER_URL", f"https://drive.google.com/drive/folders/{DRIVE_FOLDER_ID}")

MODEL = "claude-sonnet-4-6"
TDNET_BASE_URL = "https://www.release.tdnet.info/inbs/I_main_00.html"
TDNET_SEARCH_URL = "https://www.release.tdnet.info/inbs/I_main_00.html"
