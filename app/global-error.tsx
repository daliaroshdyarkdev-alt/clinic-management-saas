"use client";

/** Last-resort boundary when the root layout itself fails: bilingual, no details. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
        <h1>حدث خطأ ما · Something went wrong</h1>
        <p>يرجى المحاولة مرة أخرى. · Please try again.</p>
        <button type="button" onClick={reset}>
          حاول مرة أخرى · Try again
        </button>
      </body>
    </html>
  );
}
