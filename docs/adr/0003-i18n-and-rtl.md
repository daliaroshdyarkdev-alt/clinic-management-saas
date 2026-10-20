# ADR-0003: Locale routing, Arabic-first, RTL

- **Status:** Accepted (Milestone 0)
- **Decision:** The locale is the root route segment (`/ar`, `/en`). Arabic is the default when no cookie or `Accept-Language` preference matches. The root layout sets `<html lang dir>` from the segment, so the static shell is correct before hydration. Dictionaries are typed TypeScript objects; the English dictionary must satisfy the Arabic dictionary's type, and a unit test checks key parity. Components use logical CSS (`ms-`, `pe-`, `start-`, `text-start`) instead of left/right.
- **Rejected:** A cookie-only locale (makes the root layout request-bound under Cache Components); i18n libraries (not needed at this size, can be added later).
