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


def run(dry_run: bool = False, skip_tdnet: bool = False):
    out_dir = setup_output_dir()

    # ── STEP 1: Stock Extraction ─────────────────────────────────────────────
    logger.info("=" * 60)
    logger.info("STEP 1: Extracting stocks (Claude API)")
    logger.info("=" * 60)

    extraction = extract_stocks(api_key=config.ANTHROPIC_API_KEY, dry_run=dry_run)

    # Save raw Claude output
    raw_path = out_dir / "raw_stock_extraction.txt"
    raw_path.write_text(extraction.raw_text, encoding="utf-8")
    logger.info(f"Raw stock extraction saved to {raw_path}")

    # Save structured stocks as JSON
    all_stocks = extraction.all_stocks()
    stocks_data = [
        {
            "code": s.code,
            "name": s.name,
            "section": s.section,
            "category": s.category,
            "content": s.content,
            "notes": s.notes,
        }
        for s in all_stocks
    ]
    stocks_path = out_dir / "stocks.json"
    stocks_path.write_text(
        json.dumps(stocks_data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info(f"Stocks JSON saved to {stocks_path} ({len(stocks_data)} stocks)")

    if not all_stocks:
        logger.warning("No stocks extracted. Stopping pipeline.")
        return

    # ── STEP 2: TDnet Download ───────────────────────────────────────────────
    if skip_tdnet:
        logger.info("STEP 2: Skipping TDnet download (--skip-tdnet flag).")
    else:
        logger.info("=" * 60)
        logger.info("STEP 2: Downloading earnings PDFs from TDnet → Google Drive")
        logger.info("=" * 60)

        if not config.GOOGLE_SERVICE_ACCOUNT_JSON and not dry_run:
            logger.warning(
                "GOOGLE_SERVICE_ACCOUNT_JSON not set. Skipping TDnet upload. "
                "Set this env var to enable Google Drive upload."
            )
        else:
            stock_codes = [s.code for s in all_stocks]
            tdnet_results = process_stocks(
                stock_codes=stock_codes,
                folder_id=config.DRIVE_FOLDER_ID,
                service_account_json=config.GOOGLE_SERVICE_ACCOUNT_JSON or "{}",
                dry_run=dry_run,
            )
            tdnet_path = out_dir / "tdnet_uploads.json"
            tdnet_path.write_text(
                json.dumps(tdnet_results, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            logger.info(f"TDnet results saved to {tdnet_path}")

    # ── STEP 3: Content Generation ───────────────────────────────────────────
    logger.info("=" * 60)
    logger.info("STEP 3: Generating X posts + image prompts (Claude API)")
    logger.info("=" * 60)

    affiliate_link = get_random_affiliate_link()
    logger.info(f"Affiliate link selected: {affiliate_link}")

    generation = generate_content(
        api_key=config.ANTHROPIC_API_KEY,
        drive_folder_url=config.DRIVE_FOLDER_URL,
        affiliate_link=affiliate_link,
        dry_run=dry_run,
    )

    # Save raw content generation output
    raw_content_path = out_dir / "raw_content_generation.txt"
    raw_content_path.write_text(generation.raw_text, encoding="utf-8")

    # Save X posts
    x_posts_lines = []
    for company in generation.companies:
        x_posts_lines.append(f"# {company.company_identifier}")
        x_posts_lines.append(company.x_post)
        x_posts_lines.append("\n" + "─" * 40 + "\n")

    x_posts_path = out_dir / "x_posts.txt"
    x_posts_path.write_text("\n".join(x_posts_lines), encoding="utf-8")
    logger.info(f"X posts saved to {x_posts_path}")

    # Save image prompts
    image_prompt_lines = []
    for company in generation.companies:
        image_prompt_lines.append(f"# {company.company_identifier}")
        image_prompt_lines.append(company.image_prompt)
        image_prompt_lines.append("\n" + "─" * 40 + "\n")

    image_prompts_path = out_dir / "image_prompts.txt"
    image_prompts_path.write_text("\n".join(image_prompt_lines), encoding="utf-8")
    logger.info(f"Image prompts saved to {image_prompts_path}")

    # ── Summary ──────────────────────────────────────────────────────────────
    logger.info("=" * 60)
    logger.info("Pipeline complete.")
    logger.info(f"  Trading date  : {extraction.trading_date}")
    logger.info(f"  Stocks found  : {len(all_stocks)}")
    logger.info(f"  Posts created : {len(generation.companies)}")
    logger.info(f"  Output folder : {out_dir.resolve()}")
    logger.info("=" * 60)

    print(f"\n✅ 完了！出力フォルダ: {out_dir.resolve()}")
    print(f"   stocks.json      → 抽出銘柄リスト")
    print(f"   x_posts.txt      → X投稿文（アフィリエイトリンク付き）")
    print(f"   image_prompts.txt → ChatGPT画像生成指示書")


def main():
    parser = argparse.ArgumentParser(
        description="@kessan_class X posting automation pipeline"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run without making real API calls (for testing)",
    )
    parser.add_argument(
        "--skip-tdnet",
        action="store_true",
        help="Skip TDnet download step (use existing Drive files)",
    )
    args = parser.parse_args()

    if args.dry_run:
        logger.info("🔍 DRY RUN MODE - No real API calls will be made.")

    try:
        run(dry_run=args.dry_run, skip_tdnet=args.skip_tdnet)
    except KeyboardInterrupt:
        logger.info("Interrupted by user.")
        sys.exit(0)
    except Exception as e:
        logger.exception(f"Pipeline failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
