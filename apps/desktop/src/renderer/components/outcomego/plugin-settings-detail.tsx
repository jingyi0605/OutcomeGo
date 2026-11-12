import { useI18n } from "../../lib/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export type PluginAuthMode = "none" | "token" | "oauth";

export function PluginAuthSelect({
  className,
  onChange,
  value,
}: {
  className: string;
  onChange: (value: PluginAuthMode) => void;
  value: PluginAuthMode;
}) {
  const { t } = useI18n();
  return (
    <Select onValueChange={(next) => onChange(next as PluginAuthMode)} value={value}>
      <SelectTrigger aria-label={t("Authentication")} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{t("None")}</SelectItem>
        <SelectItem value="token">{t("Token or headers")}</SelectItem>
        <SelectItem value="oauth">{t("OAuth")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
