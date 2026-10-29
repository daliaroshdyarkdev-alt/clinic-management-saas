import { Input } from "@/components/ui/input";

/** EGP amount input; parsed into integer piasters on the server. */
export function MoneyInput({
  name = "amount",
  label,
  required = true,
}: {
  name?: string;
  label: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <Input
        name={name}
        inputMode="decimal"
        dir="ltr"
        required={required}
        placeholder="0.00"
        pattern="[0-9٠-٩]+([.٫][0-9٠-٩]{1,2})?"
      />
    </label>
  );
}
