# AI Feed Validator

A modern, modular feed validator for AI platforms. Currently supports **OpenAI Product Feed** format with plans to add more AI platform formats.

## Features

- **OpenAI Feed Validation** - Validates product feeds against [OpenAI's Commerce Feed Specification](https://developers.openai.com/commerce/specs/feed)
- **Field Mapping** - Automatic and manual field mapping to handle different CSV column naming conventions
- **Data Normalization** - Automatically converts common data formats (price, availability, etc.)
- **Multiple Formats** - Supports JSONL and CSV, including gzipped versions (.jsonl.gz, .csv.gz). OpenAI's own delivery is SFTP, full snapshot only (no delta/incremental) on at least a daily cadence; it prefers `parquet`, with `jsonl.gz`, `csv.gz`, and `tsv.gz` also supported.
- **Export Validated Feed** - Download corrected/normalized feed as gzipped JSONL ready for AI platforms
- **Modular Architecture** - Easy to add new validators for other AI platforms

## Tech Stack

- **Next.js 16** with Turbopack
- **React 19**
- **TypeScript 5.9**
- **Bun** as package manager and runtime
- **Zod 4** for schema validation
- **Tailwind CSS 4** with shadcn/ui components

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.3+

### Installation

```bash
# Clone the repository
git clone https://github.com/MyAIPlugins/ac-feed-validator.git
cd ac-feed-validator

# Install dependencies
bun install

# Run development server
bun dev
```

Open [http://localhost:3000](http://localhost:3000) to use the validator.

### Build for Production

```bash
bun run build
bun start
```

## Usage

1. **Select a Validator** - Choose "OpenAI Product Feed" (more coming soon)
2. **Upload Your Feed** - Drag & drop or click to upload CSV, JSONL, or gzipped versions
3. **Map Fields** (Optional) - Click "Map Fields" to review/adjust how your columns map to OpenAI fields
4. **Validate** - Click "Validate Feed" to check your data
5. **Export** - Download the validated and normalized feed as gzipped JSONL

### Field Mapping

The validator automatically recognizes common field name variations:

| Your Column | OpenAI Field |
|-------------|--------------|
| `link`, `product_url` | `url` |
| `image_link`, `image` | `image_url` |
| `enable_search` | `is_eligible_search` |
| `enable_chat` | `is_eligible_chat` |
| ... and more |

### Data Normalization

The validator automatically normalizes:

- **Price**: `63,00 EUR` → `63.00 EUR` (a currency code is required, e.g. `63.00 EUR`, not a bare number)
- **Availability**: `in stock` → `in_stock`
- **Return Deadline**: `14 days` → `14`
- **Brand**: Empty brands default to title

## Architecture

```
src/
├── app/
│   └── page.tsx                    # Main UI (100% client-side)
├── components/
│   ├── field-mapping-dialog.tsx
│   ├── file-upload.tsx
│   ├── validation-results.tsx
│   └── validator-select.tsx
└── lib/
    ├── parsers/                    # CSV/JSONL parsing with gzip support
    └── validators/
        ├── types.ts                # Shared validator types
        ├── registry.ts             # Validator registry
        ├── validate-client.ts      # Client-side validation logic
        └── openai/                 # OpenAI validator module
            └── schema.ts           # Zod schema with aliases & normalizers
```

### Adding New Validators

Create a new folder in `src/lib/validators/` with a `schema.ts` file implementing the `ValidatorModule` interface:

```typescript
import type { ValidatorModule } from "../types";

export const myValidator: ValidatorModule = {
  id: "my-platform",
  name: "My AI Platform Feed",
  description: "...",
  version: "1.0.0",
  supportedFormats: ["jsonl", "csv"],
  schema: myZodSchema,
  fieldAliases: { /* source -> target mappings */ },
  fieldNormalizers: { /* field transformation functions */ },
  validateRecord: (record, row) => { /* validation logic */ },
};
```

Then register it in `src/lib/validators/registry.ts`.

## Deployment

This app is deployed on [Vercel](https://vercel.com): **https://ac-feed-validator.vercel.app/**

To deploy your own instance:
```bash
vercel
```

## Privacy

🔒 **100% Client-Side Processing** - Your data never leaves your browser.

- All validation happens locally in your browser
- No data is sent to any server
- No cookies or tracking
- No analytics or data collection
- Your feed files remain completely private

This app is a static site with zero server-side processing. You can verify this by checking the source code or monitoring network requests.

**Delta Feeds are not supported by design** - OpenAI's Delta Feeds API (`PATCH /feeds/{feed_id}/products`) requires a live call authenticated with an Ads API key. Supporting it here would mean putting that key in a static, client-side page, which breaks the 100%-client-side / data-never-leaves-your-browser guarantee above. This tool validates and exports full feed files for manual upload instead.

## Status

⚠️ **Early Release (v1.0)** - This is the first version and may have bugs or unexpected behavior with feed generators different from the ones tested. More platform compatibility and improvements are coming soon as I need to use this tool for other clients with different e-commerce platforms.

## Attribution

**Created by:** [Alan Curtis](https://www.alancurtisagency.com)

**Code written by:** [Claude Code](https://claude.ai/claude-code) (Anthropic's AI coding assistant)

This project was entirely coded by Claude Code (Claude Opus 4.5) through pair programming with Alan Curtis. We believe in transparency about AI-assisted development.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. Some areas where help is appreciated:

- Adding new AI platform validators (Google, Amazon, etc.)
- Improving field mapping heuristics
- Adding more data normalizers
- UI/UX improvements

## Links

- [OpenAI Feed Specification](https://developers.openai.com/commerce/specs/feed)
- [AC Agency - Las Palmas de Gran Canaria](https://www.alancurtisagency.com)
- [Report Issues](https://github.com/MyAIPlugins/ac-feed-validator/issues)
