# Makefile for Redemption Tournament Tracker

# Variables
PROJECT_NAME = redemption-tournament-tracker
PARAGON_CSV_URL = https://docs.google.com/spreadsheets/d/e/2PACX-1vSGru8yp-5e84cRUuEghnUasXtf2Ep_MfZ4XAYHC81VTfCw9PdkRL1VblX1U_PVl8HuWG3f_4XL6PdO/pub?output=csv
PARAGON_CSV_PATH = app/decklist/card-search/data/paragons.csv
PARAGON_TS_PATH = app/decklist/card-search/data/paragons.ts
CARD_DATA_URL = https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/carddata.txt
CARD_DATA_TXT_PATH = scripts/data/carddata.txt
CARD_DATA_TS_PATH = lib/cards/generated/cardData.ts

# Default target
all: setup

# Help
help:
	@echo "📖 Redemption Tournament Tracker - Make Commands"
	@echo ""
	@echo "Setup & Development:"
	@echo "  make install         - Install dependencies"
	@echo "  make dev            - Run development server"
	@echo "  make dev-windows    - Run dev server (Windows: auto-adds Node.js to PATH)"
	@echo "  make build          - Build for production"
	@echo "  make start          - Start production server"
	@echo "  make stop           - Stop all running dev servers"
	@echo ""
	@echo "Maintenance:"
	@echo "  make clean          - Remove node_modules and lock files"
	@echo "  make fresh          - Clean and reinstall"
	@echo ""
	@echo "Paragon Data:"
	@echo "  make update-paragons - Download latest Paragon data and regenerate TypeScript"
	@echo "  make paragons        - Alias for update-paragons"
	@echo ""
	@echo "Card Data:"
	@echo "  make update-cards    - Download latest card data and regenerate TypeScript"
	@echo "  make cards           - Alias for update-cards"
	@echo "  make pull-forge-releases - Sync forge-released sets into the catalog overlay"
	@echo "  make forge-frames    - Regenerate the Forge frame kit from the card template (.ai)"
	@echo "  make forge-fonts     - Upload the printed card faces (tmp/) to the private Forge Blob store"
	@echo "  make forge-font-metrics - Regenerate the body + title advance widths for the preview's text fit (needs tmp/SYMPHOBL.TTF)"
	@echo "  make pull-card-overrides - Sync catalog admin edits into the overlay"
	@echo ""

# Install dependencies
install:
	npm install

# Run the development server
run:
	npm run dev
	
dev:
	npm run dev

# Windows: Add Node.js to PATH and run dev server (with SSL bypass for corporate proxies)
# Copy-paste this into PowerShell: $env:Path += ';C:\Program Files\nodejs\'; $env:NODE_TLS_REJECT_UNAUTHORIZED='0'; npm run dev
dev-windows:
	@powershell -Command "$$env:Path += ';C:\\Program Files\\nodejs\\'; $$env:NODE_TLS_REJECT_UNAUTHORIZED='0'; npm run dev"

# Build the project
build:
	npm run build

# Start the production server
start:
	npm run start

# Stop all running Next.js dev servers (and free common dev ports)
stop:
	@echo "🛑 Stopping all dev servers..."
	@pkill -f "next dev" 2>/dev/null || true
	@pkill -f "next-server" 2>/dev/null || true
	@lsof -ti:3000,3001,3002 2>/dev/null | xargs kill 2>/dev/null || true
	@echo "✅ Dev servers stopped"

# Setup the project
setup: install

# Clean up node_modules and lock files
clean:
	rm -rf node_modules package-lock.json

# Initialize a fresh project (clean and setup)
fresh: clean setup

# Paragon data management
update-paragons:
	@echo "📥 Downloading latest Paragon data from Google Sheets..."
	@curl -sL "$(PARAGON_CSV_URL)" > $(PARAGON_CSV_PATH)
	@echo "✅ Downloaded to $(PARAGON_CSV_PATH)"
	@echo "🔄 Generating TypeScript data..."
	@node scripts/parse-paragons.js
	@echo "✅ Paragon data updated successfully!"
	@echo "📊 Generated $(PARAGON_TS_PATH)"

# Check Paragon data (download and generate)
paragons: update-paragons

# Card data management
update-cards:
	@echo "📥 Downloading latest card data from GitHub..."
	@mkdir -p $(dir $(CARD_DATA_TXT_PATH))
	@curl -sL "$(CARD_DATA_URL)" > $(CARD_DATA_TXT_PATH)
	@echo "✅ Downloaded to $(CARD_DATA_TXT_PATH)"
	@echo "🔄 Generating TypeScript data..."
	@node scripts/parse-carddata.js
	@echo "✅ Card data updated successfully!"

cards: update-cards

# Sync forge-released sets from Supabase into the overlay + regenerate the catalog.
# Needs .env.local (service key) — run from the main checkout, not a bare worktree.
pull-forge-releases:
	@echo "📥 Syncing forge releases from Supabase..."
	@node scripts/pull-forge-releases.js

# Sync catalog admin edits (card_overrides + card_aliases + card_image_versions) into the
# overlay + regenerate the catalog. Needs .env.local (service key).
pull-card-overrides:
	@echo "📥 Syncing card overrides from Supabase..."
	@node scripts/pull-card-overrides.js

# Regenerate the Forge frame kit (public/forge/frames) + app/forge/lib/frameGeometry.ts from
# the design team's Illustrator card template. The .ai is confidential and gitignored (tmp/);
# only the derived files are committed. Needs python3.11 + Pillow, zstd, poppler.
FORGE_TEMPLATE_AI ?= tmp/Card_Template-SHUFFLED_3.7.ai
forge-frames:
	@echo "🎨 Extracting the Forge frame kit from $(FORGE_TEMPLATE_AI)..."
	@python3.11 scripts/forge-extract-template.py --ai "$(FORGE_TEMPLATE_AI)"

# Upload the printed card faces (licensed, gitignored in tmp/) to the private Forge Blob store;
# /forge/api/fonts/[face] streams them to members. Bump ?v= in app/forge/forge-fonts.css after.
FORGE_FONTS_DIR ?= tmp
forge-fonts:
	@echo "🔤 Uploading the printed card faces from $(FORGE_FONTS_DIR)/ to the private Forge Blob store..."
	@npx tsx scripts/forge-upload-fonts.ts "$(FORGE_FONTS_DIR)"

# Regenerate app/forge/lib/fontMetrics.ts (Arimo Bold / Italic advance widths) from public/forge/fonts.
forge-font-metrics:
	@python3.11 scripts/forge-font-metrics.py --title "$(FORGE_FONTS_DIR)/SYMPHOBL.TTF"

.PHONY: all install run dev dev-windows build start stop setup clean fresh update-paragons paragons update-cards cards pull-forge-releases pull-card-overrides forge-frames forge-fonts forge-font-metrics
