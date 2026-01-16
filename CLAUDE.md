# AI Feed Validator - Claude Code Instructions

## Project Overview

AI Feed Validator is a modular web application for validating product feeds destined for AI platforms. Built with Next.js 16, TypeScript, and Zod for schema validation.

## Architecture

### Validator System

The validator system follows a modular registry pattern:

- **Registry** (`src/lib/validators/registry.ts`) - Central hub for all validators
- **Types** (`src/lib/validators/types.ts`) - Shared interfaces including `ValidatorModule`, `FieldAliases`, `FieldNormalizers`
- **Validators** (`src/lib/validators/[platform]/schema.ts`) - Platform-specific Zod schemas

### Key Concepts

1. **Field Aliases** - Map source column names to target schema fields
2. **Field Normalizers** - Transform data values (price format, availability format, etc.)
3. **Default Values** - Fill in missing required fields with sensible defaults

### File Parsing

Located in `src/lib/parsers/index.ts`:
- Uses `papaparse` for CSV
- Native JSON parsing for JSONL
- `DecompressionStream` for gzip decompression (browser API)

### Client-Side Validation

All validation happens 100% client-side - no data leaves the browser:
- `src/lib/validators/validate-client.ts` - Main validation function
- Uses browser APIs only (no server-side dependencies)
- Privacy-first: your data never touches any server

## Tech Stack

- Next.js 16 (App Router, Turbopack)
- React 19
- TypeScript 5.9
- Bun (package manager & runtime)
- Zod 4 (schema validation)
- Tailwind CSS 4
- shadcn/ui components

## Code Style

- Strict TypeScript (no `any`)
- Async/await over promises with then/catch
- Explicit types on function signatures
- Use `??` for defaults, not `||`
- Keep functions small and focused

## Adding New Validators

1. Create folder: `src/lib/validators/[platform]/`
2. Create `schema.ts` implementing `ValidatorModule`
3. Register in `src/lib/validators/registry.ts`

Example validator structure:
```typescript
export const validator: ValidatorModule = {
  id: "platform-id",
  name: "Platform Name",
  description: "...",
  version: "1.0.0",
  supportedFormats: ["jsonl", "csv"],
  schema: zodSchema,
  fieldAliases: {},
  fieldNormalizers: {},
  validateRecord: (record, row) => { ... }
};
```

## Important Files

- `src/lib/validators/validate-client.ts` - Client-side validation logic
- `src/lib/validators/openai/schema.ts` - OpenAI validator (reference implementation)
- `src/components/field-mapping-dialog.tsx` - Manual field mapping UI
- `src/app/page.tsx` - Main UI (100% client-side)

## Testing

When testing validation:
1. Use real feed samples when possible
2. Test both CSV and JSONL formats
3. Test gzipped versions
4. Verify field mapping auto-detection
5. Check data normalization (price, availability formats)

## Deployment

Deployed on Vercel as a static site. The app is 100% client-side:
- No server-side processing
- No API routes
- All validation happens in the browser
- Privacy-first: user data never leaves their device
