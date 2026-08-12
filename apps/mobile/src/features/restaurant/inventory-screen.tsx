import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  ApiError,
  adjustStoreInventory,
  cancelStorePurchaseOrder,
  createStorePurchaseOrder,
  createStoreSupplier,
  listStoreInventory,
  listStoreInventoryMovements,
  listStorePurchaseOrders,
  listStoreSuppliers,
  lookupStoreInventoryBarcode,
  receiveStorePurchaseOrder,
  type InventoryItem,
  type InventoryMovement,
  type InventoryPage,
  type PurchaseOrder,
  type Supplier
} from "../../core/api";
import { getAccessToken } from "../../core/session";
import i18n from "../../i18n";
import { colors, radius, spacing } from "../../theme/tokens";
import { text } from "../../theme/typography";

export function InventoryWorkspace() {
  const { t } = useTranslation(["restaurantOps", "common"]);
  const [inventory, setInventory] = useState<InventoryPage | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [adjustment, setAdjustment] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [purchaseSupplierId, setPurchaseSupplierId] = useState("");
  const [purchaseItemId, setPurchaseItemId] = useState("");
  const [purchaseQuantity, setPurchaseQuantity] = useState("");
  const [purchaseUnitCost, setPurchaseUnitCost] = useState("");
  const [purchaseReference, setPurchaseReference] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load(nextSearch = search, nextLowStock = lowStockOnly) {
    setError(null);
    try {
      const token = await requireToken();
      const [inventoryPage, movementPage, nextSuppliers, nextPurchaseOrders] = await Promise.all([
        listStoreInventory(token, { search: nextSearch.trim() || undefined, lowStock: nextLowStock || undefined, pageSize: 100 }),
        listStoreInventoryMovements(token, 1, 30),
        listStoreSuppliers(token),
        listStorePurchaseOrders(token)
      ]);
      setInventory(inventoryPage);
      setMovements(movementPage.items);
      setSuppliers(nextSuppliers);
      setPurchaseOrders(nextPurchaseOrders);
      setSelectedItemId((current) => current || inventoryPage.items[0]?.id || "");
      setPurchaseItemId((current) => current || inventoryPage.items[0]?.id || "");
      setPurchaseSupplierId((current) => current || nextSuppliers[0]?.id || "");
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function run(action: (token: string) => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action(await requireToken());
      setNotice(message);
      await load();
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function findBarcode() {
    if (!barcode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const item = await lookupStoreInventoryBarcode(await requireToken(), barcode.trim());
      setSelectedItemId(item.id);
      setPurchaseItemId(item.id);
      setNotice(t("inventory.barcodeMatchedNotice", { name: item.name }));
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>;

  const summary = inventory?.summary;
  return (
    <View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.success}>{notice}</Text> : null}

      <View style={styles.summaryGrid}>
        <Summary label={t("inventory.productsLabel")} value={summary?.totalProducts ?? 0} />
        <Summary label={t("inventory.trackedLabel")} value={summary?.trackedProducts ?? 0} />
        <Summary label={t("inventory.lowStockLabel")} value={summary?.lowStockProducts ?? 0} alert />
        <Summary label={t("inventory.outLabel")} value={summary?.outOfStockProducts ?? 0} alert />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("inventory.findInventoryTitle")}</Text>
        <Field label={t("inventory.searchLabel")} value={search} onChangeText={setSearch} />
        <View style={styles.row}>
          <Button disabled={busy} label={t("common:search")} onPress={() => void load(search, lowStockOnly)} />
          <Button
            disabled={busy}
            label={lowStockOnly ? t("inventory.showAllButton") : t("inventory.lowStockOnlyButton")}
            onPress={() => {
              const next = !lowStockOnly;
              setLowStockOnly(next);
              void load(search, next);
            }}
            secondary
          />
        </View>
        <Field label={t("inventory.barcodeLookupLabel")} value={barcode} onChangeText={setBarcode} keyboardType="number-pad" />
        <Button disabled={busy || !barcode.trim()} label={t("inventory.lookUpBarcodeButton")} onPress={() => void findBarcode()} secondary />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("inventory.manualAdjustmentTitle")}</Text>
        <ItemPicker items={inventory?.items ?? []} selectedId={selectedItemId} onSelect={setSelectedItemId} />
        <Field label={t("inventory.changeLabel")} value={adjustment} onChangeText={setAdjustment} keyboardType="numbers-and-punctuation" />
        <Field label={t("inventory.reasonLabel")} value={adjustmentReason} onChangeText={setAdjustmentReason} />
        <Button
          disabled={busy || !selectedItemId || !adjustment.trim() || adjustmentReason.trim().length < 2}
          label={t("inventory.applyAdjustmentButton")}
          onPress={() => void run(
            (token) => adjustStoreInventory(token, selectedItemId, Number.parseInt(adjustment, 10), adjustmentReason.trim()),
            t("inventory.adjustmentAppliedNotice")
          ).then(() => { setAdjustment(""); setAdjustmentReason(""); })}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("inventory.productsTitle")}</Text>
        {(inventory?.items ?? []).map((item) => (
          <Pressable key={item.id} onPress={() => setSelectedItemId(item.id)} style={[styles.itemCard, item.isLowStock && styles.lowStockCard]}>
            <View style={styles.itemCopy}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.meta}>{item.sku ?? t("inventory.noSku")}{item.barcode ? ` · ${item.barcode}` : ""}</Text>
            </View>
            <Text style={[styles.stock, item.isLowStock && styles.stockAlert]}>
              {item.stockQuantity === null ? t("inventory.untracked") : `${item.stockQuantity} ${item.unitLabel}`}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("inventory.suppliersTitle")}</Text>
        <Field label={t("inventory.supplierNameLabel")} value={supplierName} onChangeText={setSupplierName} />
        <Field label={t("inventory.phoneOptionalLabel")} value={supplierPhone} onChangeText={setSupplierPhone} keyboardType="phone-pad" />
        <Button
          disabled={busy || supplierName.trim().length < 2}
          label={t("inventory.addSupplierButton")}
          onPress={() => void run(
            (token) => createStoreSupplier(token, { name: supplierName.trim(), phone: supplierPhone.trim() || undefined }),
            t("inventory.supplierAddedNotice")
          ).then(() => { setSupplierName(""); setSupplierPhone(""); })}
        />
        {suppliers.map((supplier) => <Text key={supplier.id} style={styles.listLine}>{supplier.name}{supplier.phone ? ` · ${supplier.phone}` : ""}</Text>)}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("inventory.newPurchaseOrderTitle")}</Text>
        <Text style={styles.label}>{t("inventory.supplierLabel")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.picker}>
          {suppliers.map((supplier) => <Chip key={supplier.id} active={purchaseSupplierId === supplier.id} label={supplier.name} onPress={() => setPurchaseSupplierId(supplier.id)} />)}
        </ScrollView>
        <Text style={styles.label}>{t("inventory.productLabel")}</Text>
        <ItemPicker items={inventory?.items ?? []} selectedId={purchaseItemId} onSelect={setPurchaseItemId} />
        <Field label={t("inventory.quantityLabel")} value={purchaseQuantity} onChangeText={setPurchaseQuantity} keyboardType="number-pad" />
        <Field label={t("inventory.unitCostLabel")} value={purchaseUnitCost} onChangeText={setPurchaseUnitCost} keyboardType="decimal-pad" />
        <Field label={t("inventory.supplierReferenceLabel")} value={purchaseReference} onChangeText={setPurchaseReference} />
        <Button
          disabled={busy || !purchaseSupplierId || !purchaseItemId || Number.parseInt(purchaseQuantity, 10) < 1}
          label={t("inventory.createDraftPurchaseButton")}
          onPress={() => void run(
            (token) => createStorePurchaseOrder(token, {
              supplierId: purchaseSupplierId,
              reference: purchaseReference.trim() || undefined,
              items: [{
                menuItemId: purchaseItemId,
                quantity: Number.parseInt(purchaseQuantity, 10),
                unitCostMinor: Math.max(0, Math.round(Number(purchaseUnitCost.replace(",", ".")) * 100) || 0)
              }]
            }),
            t("inventory.draftPurchaseCreatedNotice")
          ).then(() => { setPurchaseQuantity(""); setPurchaseUnitCost(""); setPurchaseReference(""); })}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("inventory.purchaseOrdersTitle")}</Text>
        {purchaseOrders.length === 0 ? <Text style={styles.meta}>{t("inventory.noPurchaseOrders")}</Text> : null}
        {purchaseOrders.map((order) => (
          <View key={order.id} style={styles.purchaseCard}>
            <Text style={styles.itemName}>{order.reference ?? t("inventory.purchaseFallbackName", { id: order.id.slice(0, 8) })}</Text>
            <Text style={styles.meta}>{order.supplier.name} · {t(`common:status.${order.status}`, order.status)} · {formatMoney(order.totalCostMinor)}</Text>
            {order.items.map((line) => <Text key={line.id} style={styles.listLine}>{line.quantity} × {line.menuItem.name}</Text>)}
            {order.status === "DRAFT" ? (
              <View style={styles.row}>
                <Button disabled={busy} label={t("inventory.receiveStockButton")} onPress={() => void run((token) => receiveStorePurchaseOrder(token, order.id), t("inventory.purchaseReceivedNotice"))} />
                <Button disabled={busy} label={t("common:cancel")} onPress={() => void run((token) => cancelStorePurchaseOrder(token, order.id), t("inventory.purchaseCancelledNotice"))} secondary />
              </View>
            ) : null}
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("inventory.recentMovementsTitle")}</Text>
        {movements.map((movement) => (
          <View key={movement.id} style={styles.movementRow}>
            <View style={styles.itemCopy}>
              <Text style={styles.itemName}>{movement.menuItem.name}</Text>
              <Text style={styles.meta}>{movement.type.replaceAll("_", " ")} · {movement.reason ?? t("inventory.systemMovement")}</Text>
            </View>
            <Text style={[styles.stock, movement.quantityDelta < 0 && styles.stockAlert]}>
              {movement.quantityDelta > 0 ? "+" : ""}{movement.quantityDelta} → {movement.stockAfter}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Summary(props: { label: string; value: number; alert?: boolean }) {
  return <View style={[styles.summaryCard, props.alert && props.value > 0 && styles.summaryAlert]}><Text style={styles.summaryValue}>{props.value}</Text><Text style={styles.meta}>{props.label}</Text></View>;
}

function ItemPicker(props: { items: InventoryItem[]; selectedId: string; onSelect: (id: string) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.picker}>{props.items.map((item) => <Chip key={item.id} active={props.selectedId === item.id} label={item.name} onPress={() => props.onSelect(item.id)} />)}</ScrollView>;
}

function Chip(props: { active: boolean; label: string; onPress: () => void }) {
  return <Pressable onPress={props.onPress} style={[styles.chip, props.active && styles.chipActive]}><Text style={[styles.chipText, props.active && styles.chipTextActive]}>{props.label}</Text></Pressable>;
}

function Field(props: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: "default" | "number-pad" | "decimal-pad" | "numbers-and-punctuation" | "phone-pad" }) {
  return <View style={styles.field}><Text style={styles.label}>{props.label}</Text><TextInput keyboardType={props.keyboardType} onChangeText={props.onChangeText} style={styles.input} value={props.value} /></View>;
}

function Button(props: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable disabled={props.disabled} onPress={props.onPress} style={[styles.button, props.secondary && styles.buttonSecondary, props.disabled && styles.disabled]}><Text style={[styles.buttonText, props.secondary && styles.buttonTextSecondary]}>{props.label}</Text></Pressable>;
}

async function requireToken() { const token = await getAccessToken(); if (!token) throw new Error(i18n.t("common:sessionExpired")); return token; }
function readError(error: unknown) { return error instanceof ApiError || error instanceof Error ? error.message : i18n.t("common:requestFailed"); }
function formatMoney(minor: number) { return `${(minor / 100).toFixed(2)} ILS`; }

const styles = StyleSheet.create({
  center: { alignItems: "center", padding: spacing[8] },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, marginBottom: spacing[4], padding: spacing[5] },
  cardTitle: { ...text("h3", "bold"), color: colors.text, marginBottom: spacing[4] },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2], marginBottom: spacing[4] },
  summaryCard: { alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.lg, flexBasis: "47%", flexGrow: 1, padding: spacing[3] },
  summaryAlert: { backgroundColor: colors.errorSubtle },
  summaryValue: { ...text("h1", "bold"), color: colors.primary },
  field: { marginBottom: spacing[3] },
  label: { ...text("caption", "bold"), color: colors.text, marginBottom: spacing[2] },
  input: { backgroundColor: colors.surfaceSunk, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.text, minHeight: 48, paddingHorizontal: spacing[3] },
  row: { flexDirection: "row", gap: spacing[2], marginBottom: spacing[3] },
  button: { alignItems: "center", backgroundColor: colors.primary, borderRadius: radius.md, flex: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: spacing[3] },
  buttonSecondary: { backgroundColor: colors.primarySubtle },
  buttonText: { ...text("caption", "bold"), color: colors.textInverse, textAlign: "center" },
  buttonTextSecondary: { color: colors.primaryPressed },
  disabled: { opacity: 0.45 },
  picker: { marginBottom: spacing[4] },
  chip: { backgroundColor: colors.surfaceSunk, borderRadius: radius.pill, marginEnd: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  chipActive: { backgroundColor: colors.primary },
  chipText: { ...text("label", "bold"), color: colors.textMuted },
  chipTextActive: { color: colors.textInverse },
  itemCard: { alignItems: "center", borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: "row", paddingVertical: spacing[3] },
  lowStockCard: { backgroundColor: colors.warningSubtle, marginHorizontal: -8, paddingHorizontal: spacing[2] },
  itemCopy: { flex: 1, paddingEnd: spacing[2] },
  itemName: { ...text("bodySm", "bold"), color: colors.text },
  meta: { ...text("label"), color: colors.textMuted, marginTop: spacing[1] },
  stock: { ...text("caption", "bold"), color: colors.success },
  stockAlert: { color: colors.error },
  listLine: { ...text("label"), color: colors.textMuted, marginTop: spacing[2] },
  purchaseCard: { borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginTop: spacing[2], padding: spacing[3] },
  movementRow: { alignItems: "center", borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: "row", paddingVertical: spacing[3] },
  error: { ...text("bodySm"), backgroundColor: colors.errorSubtle, borderRadius: radius.md, color: colors.error, marginBottom: spacing[3], padding: spacing[3] },
  success: { ...text("bodySm"), backgroundColor: colors.successSubtle, borderRadius: radius.md, color: colors.success, marginBottom: spacing[3], padding: spacing[3] }
});
