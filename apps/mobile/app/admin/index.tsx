import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

export default function AdminNative() {
  const { t } = useTranslation();
  return <View style={{ flex: 1, justifyContent: "center", padding: 24 }}><Text>{t("admin.web_only")}</Text></View>;
}
