import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import type { MenuCategoryOwner, MenuItemOwner } from "../../core/api";
import { confirmDestructive } from "../../core/confirm";
import { formatMinorPlain } from "../../core/money";
import { PriceDisplay, SaleBadge } from "../../components/sale-price";
import { RemoteImage } from "../../components/remote-image";
import { useTheme } from "../../theme/theme-context";
import { radius, spacing, type ThemeColors } from "../../theme/tokens";
import { text } from "../../theme/typography";
import { formatShekel } from "../customer/shop.rules";
import {
  ActionButton,
  AdminPage,
  EmptyState,
  ErrorBanner,
  FilterChips,
  Input,
  LoadingState,
  Pager,
  readAdminError
} from "../admin/ui";
import {
  isOnOffer,
  offerAttention,
  offerPercent,
  offerPriceForPercent,
  offerSavingMinor,
  offerSummary,
  parseOfferPrice,
  selectOfferRows,
  type OfferFilter
} from "./product-offers.rules";

/**
 * Where a product offers screen reads and writes: the manager's own store (/restaurant/me/menu/*)
 * or, for an administrator, one store by id (/admin/restaurants/:id/menu/*). Both change the one
 * existing field — `salePriceMinor` — that the customer's sticker and checkout already read.
 */
export type ProductOffersApi = {
  listCategories(): Promise<MenuCategoryOwner[]>;
  listItems(): Promise<MenuItemOwner[]>;
  updateItem(itemId: string, body: { salePriceMinor: number | null }): Promise<MenuItemOwner>;
};

const pageSize = 30;
const quickPercents = [10, 20, 25, 30, 50];
const filters: OfferFilter[] = ["all", "onSale", "notOnSale", "attention"];

/**
 * Product offers on the phone: find a product by name, SKU, barcode, brand or category, see its
 * picture and both prices, and set an offer by typing only the offer price — the discount the
 * customer will see is worked out live. Ending an offer (back to the normal price) is confirmed.
 */
export function ProductOffersScreen(props: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  /** null while the store (or the permission check) is still being resolved. */
  api: ProductOffersApi | null;
  /** Identifies the store, so switching stores reloads. */
  storeKey: string;
  canEdit: boolean;
  /** Extra controls above the list, e.g. the administrator's store picker. */
  header?: ReactNode;
}) {
  const { t } = useTranslation(["admin", "common"]);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [items, setItems] = useState<MenuItemOwner[] | null>(null);
  const [categories, setCategories] = useState<MenuCategoryOwner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<OfferFilter>("all");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<MenuItemOwner | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { api } = props;

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setItems(null);
    setError(null);
    Promise.all([api.listItems(), api.listCategories()])
      .then(([loadedItems, loadedCategories]) => {
        if (cancelled) return;
        setItems(loadedItems);
        setCategories(loadedCategories);
      })
      .catch((caught) => !cancelled && setError(readAdminError(caught)));
    return () => {
      cancelled = true;
    };
  }, [api, props.storeKey, reload]);

  useEffect(() => {
    setPage(1);
  }, [search, filter, categoryId, props.storeKey]);

  const categoryNames = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const rows = useMemo(
    () => (items ? selectOfferRows(items, { search, categoryId, filter, categoryNames }) : []),
    [items, search, categoryId, filter, categoryNames]
  );
  const summary = useMemo(() => offerSummary(items ?? []), [items]);
  const counts = useMemo(() => {
    const all = items ?? [];
    return {
      all: all.length,
      onSale: summary.onOffer,
      notOnSale: all.length - summary.onOffer,
      attention: summary.attention
    } satisfies Record<OfferFilter, number>;
  }, [items, summary]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const visible = rows.slice((page - 1) * pageSize, page * pageSize);

  function applySaved(saved: MenuItemOwner, message: string) {
    setItems((current) => current?.map((item) => (item.id === saved.id ? { ...item, ...saved } : item)) ?? current);
    setEditing(null);
    setNotice(message);
  }

  return (
    <AdminPage onBack={props.onBack} subtitle={props.subtitle} title={props.title}>
      {props.header}
      {!api ? null : error ? (
        <View style={styles.stack}>
          <ErrorBanner message={t("admin:productOffers.loadError", { message: error })} />
          <ActionButton label={t("common:retry")} onPress={() => setReload((value) => value + 1)} variant="secondary" />
        </View>
      ) : !items ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState message={t("admin:productOffers.noProducts")} />
      ) : (
        <View style={styles.stack}>
          <View style={styles.tiles}>
            <SummaryTile
              active={filter === "onSale"}
              label={t("admin:productOffers.summary.onOffer")}
              onPress={() => setFilter(filter === "onSale" ? "all" : "onSale")}
              value={String(summary.onOffer)}
            />
            <SummaryTile
              label={t("admin:productOffers.summary.biggest")}
              value={summary.biggestPercent > 0 ? `${summary.biggestPercent}%` : "—"}
            />
            <SummaryTile
              active={filter === "attention"}
              label={t("admin:productOffers.summary.attention")}
              onPress={() => setFilter(filter === "attention" ? "all" : "attention")}
              tone={summary.attention > 0 ? "warning" : undefined}
              value={String(summary.attention)}
            />
          </View>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          {!props.canEdit ? <Text style={styles.readOnly}>{t("admin:productOffers.readOnly")}</Text> : null}
          <Input onChangeText={setSearch} placeholder={t("admin:productOffers.searchPlaceholder")} value={search} />
          <FilterChips
            onChange={setFilter}
            options={filters.map((value) => ({
              value,
              label: t("admin:productOffers.filterWithTotal", {
                label: t(`admin:productOffers.filters.${value}`),
                total: counts[value]
              })
            }))}
            value={filter}
          />
          {categories.length > 1 ? (
            <FilterChips
              onChange={setCategoryId}
              options={[
                { value: "", label: t("admin:productOffers.allCategories") },
                ...categories.map((category) => ({ value: category.id, label: category.name }))
              ]}
              value={categoryId}
            />
          ) : null}
          <Text style={styles.resultCount}>{t("admin:productOffers.resultCount", { shown: rows.length, total: items.length })}</Text>
          {rows.length === 0 ? (
            <View style={styles.stack}>
              <EmptyState
                message={filter === "onSale" && !search ? t("admin:productOffers.emptyOnSale") : t("admin:productOffers.emptySearch")}
              />
              <ActionButton
                label={t("admin:productOffers.clearFilters")}
                onPress={() => {
                  setSearch("");
                  setFilter("all");
                  setCategoryId("");
                }}
                variant="secondary"
              />
            </View>
          ) : (
            visible.map((item) => (
              <OfferRow
                canEdit={props.canEdit}
                categoryName={categoryNames.get(item.categoryId)}
                item={item}
                key={item.id}
                onEdit={() => {
                  setNotice(null);
                  setEditing(item);
                }}
              />
            ))
          )}
          <Pager onPage={setPage} page={page} pages={pages} />
        </View>
      )}
      {editing && api ? (
        <OfferEditor
          api={api}
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, ended) =>
            applySaved(saved, ended ? t("admin:productOffers.endedNotice", { name: saved.name }) : t("admin:productOffers.savedNotice", { name: saved.name }))
          }
        />
      ) : null}
    </AdminPage>
  );
}

function SummaryTile(props: { label: string; value: string; onPress?: () => void; active?: boolean; tone?: "warning" }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const body = (
    <>
      <Text style={[styles.tileValue, props.tone === "warning" && styles.tileWarning]}>{props.value}</Text>
      <Text style={styles.tileLabel}>{props.label}</Text>
    </>
  );
  if (!props.onPress) return <View style={styles.tile}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(props.active) }}
      onPress={props.onPress}
      style={({ pressed }) => [styles.tile, props.active && styles.tileActive, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

function OfferRow(props: { item: MenuItemOwner; categoryName?: string; canEdit: boolean; onEdit: () => void }) {
  const { t } = useTranslation(["admin"]);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { item } = props;
  const onOffer = isOnOffer(item);
  const percent = offerPercent(item);
  const attention = offerAttention(item);
  return (
    <Pressable
      accessibilityLabel={item.name}
      disabled={!props.canEdit}
      onPress={props.onEdit}
      style={({ pressed }) => [styles.row, onOffer && styles.rowOnOffer, pressed && styles.pressed]}
      testID={`offer-row-${item.id}`}
    >
      <View style={styles.thumbWrap}>
        <RemoteImage accessibilityIgnoresInvertColors resizeMode="cover" style={styles.thumb} uri={item.imageUrl} />
        {onOffer ? (
          <View pointerEvents="none" style={styles.thumbSticker}>
            <Text style={styles.thumbStickerText}>{`−${percent}%`}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.rowBody}>
        <Text numberOfLines={2} style={styles.rowName}>
          {item.name}
        </Text>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {[props.categoryName, item.sku].filter(Boolean).join(" · ")}
        </Text>
        <PriceDisplay
          effectiveMinor={onOffer ? item.salePriceMinor! : item.priceMinor}
          format={formatShekel}
          priceStyle={styles.rowPrice}
          regularMinor={item.priceMinor}
        />
        {onOffer ? (
          <Text style={styles.rowSaving}>
            {t("admin:productOffers.savesLine", { percent, amount: formatShekel(offerSavingMinor(item)) })}
          </Text>
        ) : null}
        {attention.length > 0 ? (
          <View style={styles.badges}>
            {attention.map((reason) => (
              <Text key={reason} style={styles.attentionBadge}>
                {t(`admin:productOffers.attention.${reason}`)}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
      {props.canEdit ? (
        <Text style={[styles.rowAction, onOffer && styles.rowActionEdit]}>
          {onOffer ? t("admin:productOffers.edit") : t("admin:productOffers.addOffer")}
        </Text>
      ) : null}
    </Pressable>
  );
}

function OfferEditor(props: {
  api: ProductOffersApi;
  item: MenuItemOwner;
  onClose: () => void;
  onSaved: (saved: MenuItemOwner, ended: boolean) => void;
}) {
  const { t } = useTranslation(["admin", "common"]);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { item } = props;
  const onOffer = isOnOffer(item);
  const [value, setValue] = useState(onOffer ? formatMinorPlain(item.salePriceMinor!) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseOfferPrice(item.priceMinor, value);
  const belowCost = parsed.ok && item.costPriceMinor != null && parsed.saleMinor < item.costPriceMinor;
  const unchanged = parsed.ok && onOffer && parsed.saleMinor === item.salePriceMinor;

  async function save(salePriceMinor: number | null) {
    setBusy(true);
    setError(null);
    try {
      const saved = await props.api.updateItem(item.id, { salePriceMinor });
      props.onSaved(saved, salePriceMinor === null);
    } catch (caught) {
      setError(readAdminError(caught));
      setBusy(false);
    }
  }

  async function confirmEnd() {
    const confirmed = await confirmDestructive(
      t("admin:productOffers.endTitle"),
      t("admin:productOffers.endBody", { name: item.name, price: formatShekel(item.priceMinor) }),
      t("admin:productOffers.endConfirm"),
      t("common:cancel")
    );
    if (confirmed) await save(null);
  }

  const fieldError = !parsed.ok && parsed.error !== "empty" ? t(`admin:productOffers.errors.${parsed.error}`) : null;

  return (
    <Modal animationType="slide" onRequestClose={props.onClose} transparent visible>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.backdrop}>
        <Pressable accessibilityLabel={t("common:cancel")} onPress={props.onClose} style={styles.backdropTap} />
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            <View style={styles.editorHead}>
              <RemoteImage resizeMode="cover" style={styles.editorThumb} uri={item.imageUrl} />
              <View style={styles.rowBody}>
                <Text numberOfLines={2} style={styles.editorName}>
                  {item.name}
                </Text>
                <Text style={styles.rowMeta}>
                  {t("admin:productOffers.regularPrice")}: {formatShekel(item.priceMinor)}
                </Text>
              </View>
            </View>
            <Text style={styles.fieldLabel}>{t("admin:productOffers.offerPriceLabel")}</Text>
            <View style={styles.priceField}>
              <TextInput
                accessibilityLabel={t("admin:productOffers.offerPriceLabel")}
                autoFocus
                keyboardType="decimal-pad"
                onChangeText={setValue}
                placeholder={formatMinorPlain(item.priceMinor)}
                placeholderTextColor={colors.textMuted}
                style={styles.priceInput}
                testID="offer-price-input"
                value={value}
              />
              <Text style={styles.currency}>ILS</Text>
              {parsed.ok ? (
                <Text style={styles.livePercent} testID="offer-live-percent">{`−${parsed.percent}%`}</Text>
              ) : null}
            </View>
            {fieldError ? <Text style={styles.fieldError}>{fieldError}</Text> : null}
            {parsed.ok ? (
              <Text style={styles.rowSaving}>
                {t("admin:productOffers.customerSaves", { amount: formatShekel(parsed.savingMinor), percent: parsed.percent })}
              </Text>
            ) : null}
            <Text style={styles.fieldLabel}>{t("admin:productOffers.quickLabel")}</Text>
            <View style={styles.quickRow}>
              {quickPercents.map((percent) => {
                const price = offerPriceForPercent(item.priceMinor, percent);
                if (price === null) return null;
                return (
                  <Pressable
                    accessibilityRole="button"
                    key={percent}
                    onPress={() => setValue(formatMinorPlain(price))}
                    style={({ pressed }) => [styles.quickChip, pressed && styles.pressed]}
                  >
                    <Text style={styles.quickChipText}>{`−${percent}%`}</Text>
                  </Pressable>
                );
              })}
            </View>
            {parsed.ok ? (
              <View style={styles.preview}>
                <Text style={styles.fieldLabel}>{t("admin:productOffers.previewLabel")}</Text>
                <View style={styles.previewCard}>
                  <View style={styles.previewImageWrap}>
                    <RemoteImage resizeMode="cover" style={styles.previewImage} uri={item.imageUrl} />
                    <SaleBadge item={{ priceMinor: item.priceMinor, salePriceMinor: parsed.saleMinor }} />
                  </View>
                  <PriceDisplay
                    effectiveMinor={parsed.saleMinor}
                    format={formatShekel}
                    priceStyle={styles.previewPrice}
                    regularMinor={item.priceMinor}
                  />
                </View>
              </View>
            ) : null}
            {belowCost ? (
              <Text style={styles.warning}>
                {t("admin:productOffers.belowCostWarning", { cost: formatShekel(item.costPriceMinor!) })}
              </Text>
            ) : null}
            <ErrorBanner message={error} />
            <View style={styles.editorActions}>
              <ActionButton
                disabled={!parsed.ok || unchanged}
                label={onOffer ? t("admin:productOffers.saveChange") : t("admin:productOffers.startOffer")}
                loading={busy}
                onPress={() => parsed.ok && void save(parsed.saleMinor)}
              />
              {onOffer ? (
                <ActionButton disabled={busy} label={t("admin:productOffers.end")} onPress={() => void confirmEnd()} variant="danger" />
              ) : null}
              <ActionButton disabled={busy} label={t("common:cancel")} onPress={props.onClose} variant="secondary" />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    stack: { gap: spacing[3] },
    pressed: { opacity: 0.75 },
    tiles: { flexDirection: "row", gap: spacing[2] },
    tile: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flex: 1,
      padding: spacing[3]
    },
    tileActive: { backgroundColor: colors.primarySubtle, borderColor: colors.primary },
    tileValue: { ...text("h2", "bold"), color: colors.text },
    tileWarning: { color: colors.warning },
    tileLabel: { ...text("caption"), color: colors.textMuted },
    notice: { ...text("bodySm", "medium"), backgroundColor: colors.successSubtle, borderRadius: radius.sm, color: colors.success, padding: spacing[3] },
    readOnly: { ...text("bodySm"), backgroundColor: colors.infoSubtle, borderRadius: radius.sm, color: colors.info, padding: spacing[3] },
    resultCount: { ...text("caption"), color: colors.textMuted },
    row: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing[3],
      padding: spacing[3]
    },
    rowOnOffer: { borderColor: colors.primaryBorder },
    thumbWrap: { borderRadius: radius.sm, height: 64, overflow: "hidden", width: 64 },
    thumb: { backgroundColor: colors.surfaceSunk, height: 64, width: 64 },
    thumbSticker: {
      backgroundColor: colors.primary,
      borderBottomEndRadius: radius.sm,
      paddingHorizontal: 5,
      paddingVertical: 2,
      position: "absolute",
      start: 0,
      top: 0
    },
    thumbStickerText: { ...text("caption", "bold"), color: colors.textInverse },
    rowBody: { flex: 1, gap: 2 },
    rowName: { ...text("body", "semibold"), color: colors.text },
    rowMeta: { ...text("caption"), color: colors.textMuted },
    rowPrice: { ...text("body", "bold"), color: colors.text },
    rowSaving: { ...text("caption", "medium"), color: colors.primary },
    badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing[1], marginTop: 2 },
    attentionBadge: {
      ...text("caption", "semibold"),
      backgroundColor: colors.warningSubtle,
      borderRadius: radius.pill,
      color: colors.warning,
      overflow: "hidden",
      paddingHorizontal: spacing[2],
      paddingVertical: 1
    },
    rowAction: {
      ...text("label", "bold"),
      backgroundColor: colors.primary,
      borderRadius: radius.pill,
      color: colors.textInverse,
      overflow: "hidden",
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2]
    },
    rowActionEdit: { backgroundColor: colors.primarySubtle, color: colors.primary },
    backdrop: { backgroundColor: "rgba(0,0,0,0.45)", flex: 1, justifyContent: "flex-end" },
    backdropTap: { flex: 1 },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      maxHeight: "92%"
    },
    sheetContent: { gap: spacing[3], padding: spacing[5], paddingBottom: spacing[8] },
    editorHead: { alignItems: "center", flexDirection: "row", gap: spacing[3] },
    editorThumb: { backgroundColor: colors.surfaceSunk, borderRadius: radius.sm, height: 56, width: 56 },
    editorName: { ...text("h3", "bold"), color: colors.text },
    fieldLabel: { ...text("label", "semibold"), color: colors.textMuted },
    priceField: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.primary,
      borderRadius: radius.md,
      borderWidth: 2,
      flexDirection: "row",
      gap: spacing[2],
      paddingHorizontal: spacing[4]
    },
    priceInput: { ...text("h1", "bold"), color: colors.text, flex: 1, paddingVertical: spacing[3], textAlign: "left", writingDirection: "ltr" },
    currency: { ...text("body", "semibold"), color: colors.textMuted },
    livePercent: {
      ...text("body", "bold"),
      backgroundColor: colors.primary,
      borderRadius: radius.pill,
      color: colors.textInverse,
      overflow: "hidden",
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[1]
    },
    fieldError: { ...text("bodySm", "medium"), color: colors.error },
    quickRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    quickChip: {
      backgroundColor: colors.primarySubtle,
      borderColor: colors.primaryBorder,
      borderRadius: radius.pill,
      borderWidth: 1,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2]
    },
    quickChipText: { ...text("label", "bold"), color: colors.primary },
    preview: { gap: spacing[2] },
    previewCard: {
      alignSelf: "flex-start",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      gap: spacing[2],
      padding: spacing[2],
      width: 170
    },
    previewImageWrap: { borderRadius: radius.sm, overflow: "hidden" },
    previewImage: { backgroundColor: colors.surfaceSunk, height: 130, width: "100%" },
    previewPrice: { ...text("body", "bold"), color: colors.text },
    warning: { ...text("bodySm", "medium"), backgroundColor: colors.warningSubtle, borderRadius: radius.sm, color: colors.warning, padding: spacing[3] },
    editorActions: { gap: spacing[2] }
  });
}
