"""
main.py
Orchestrates the full @kessan_class posting pipeline:
  1. Extract stocks with earnings on latest trading day (Claude API)
  2. Download earnings PDFs from TDnet and upload to Google Drive
  3. Generate X post texts + ChatGPT image prompts (Claude API)
  4. Save all outputs to output/YYYY-MM-DD/

Usage:
  python pipeline/main.py
  python pipeline/main.py --dry-run
  python pipeline/main.py --skip-tdnet   # skip TDnet download step
"""

import argparse
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

# Allow running from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config
from affiliate_links import get_random_affiliate_link
from pipeline.content_generator import generate_content
from pipeline.stock_extractor import extract_stocks
from pipeline.tdnet_downloader import process_stocks

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger("main")


def setup_output_dir(base: str = "output") -> Path:
    date_str = datetime.now().strftime("%Y-%m-%d")
    out_dir = Path(base) / date_str
    out_dir.mkdir(parents=True, exist_ok=True)

    # Also add file logging
    log_path = out_dir / "pipeline.log"
    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    )
    logging.getLogger().addHandler(file_handler)
    logger.info(f"Output directory: {out_dir}")
    return out_dir


def run(dry_run: bool = False, skip_tdnet: bool = True, step: str = "all"):
    out_dir = setup_output_dir()

    # ── STEP 1: 銘柄抽出 ────────────────────────────────────────────────────
    if step in ("extract", "all"):
        logger.info("=" * 60)
        logger.info("STEP 1: 銘柄抽出")
        logger.info("=" * 60)

        extraction = extract_stocks(
            api_key=config.GROQ_API_KEY,
            dry_run=dry_run,
            jquants_refresh_token=config.JQUANTS_REFRESH_TOKEN,
        )

        raw_path = out_dir / "raw_stock_extraction.txt"
        raw_path.write_text(extraction.raw_text, encoding="utf-8")

        all_stocks = extraction.all_stocks()
        stocks_data = [
            {"code": s.code, "name": s.name, "section": s.section,
             "category": s.category, "content": s.content, "notes": s.notes}
            for s in all_stocks
        ]
        stocks_path = out_dir / "stocks.json"
        stocks_path.write_text(json.dumps(stocks_data, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info(f"銘柄抽出完了: {len(stocks_data)}社 → {stocks_path}")

        if step == "extract":
            print(f"\n✅ 銘柄抽出完了！{out_dir}/raw_stock_extraction.txt を確認してください。")
            return

    # ── STEP 3: 投稿文生成 ──────────────────────────────────────────────────
    if step in ("generate", "all"):
        logger.info("=" * 60)
        logger.info("STEP 3: 投稿文・画像指示書生成")
        logger.info("=" * 60)

        affiliate_link = get_random_affiliate_link(
            app_id=config.RAKUTEN_APP_ID,
            affiliate_id=config.RAKUTEN_AFFILIATE_ID,
        )
        logger.info(f"アフィリエイトリンク: {affiliate_link}")

        generation = generate_content(
            api_key=config.GROQ_API_KEY,
            drive_folder_url=config.DRIVE_FOLDER_URL,
            affiliate_link=affiliate_link,
            dry_run=dry_run,
            service_account_json=config.GOOGLE_SERVICE_ACCOUNT_JSON,
            folder_id=config.DRIVE_FOLDER_ID,
        )

        (out_dir / "raw_content_generation.txt").write_text(generation.raw_text, encoding="utf-8")

        x_posts_lines = []
        for company in generation.companies:
            x_posts_lines.append(f"# {company.company_identifier}")
            x_posts_lines.append(company.x_post)
            x_posts_lines.append("\n" + "─" * 40 + "\n")
        (out_dir / "x_posts.txt").write_text("\n".join(x_posts_lines), encoding="utf-8")

        image_prompt_lines = []
        for company in generation.companies:
            image_prompt_lines.append(f"# {company.company_identifier}")
            image_prompt_lines.append(company.image_prompt)
            image_prompt_lines.append("\n" + "─" * 40 + "\n")
        (out_dir / "image_prompts.txt").write_text("\n".join(image_prompt_lines), encoding="utf-8")

        logger.info(f"投稿文生成完了: {len(generation.companies)}社")
        print(f"\n✅ 投稿文生成完了！{out_dir}/x_posts.txt を確認してください。")


def main():
    parser = argparse.ArgumentParser(
        description="@kessan_class X posting automation pipeline"
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-tdnet", action="store_true")
    parser.add_argument(
        "--step",
        choices=["extract", "generate", "all"],
        default="all",
        help="extract=銘柄抽出のみ / generate=投稿文生成のみ / all=全実行",
    )
    args = parser.parse_args()

    try:
        run(dry_run=args.dry_run, skip_tdnet=args.skip_tdnet, step=args.step)
    except KeyboardInterrupt:
        logger.info("Interrupted by user.")
        sys.exit(0)
    except Exception as e:
        logger.exception(f"Pipeline failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
