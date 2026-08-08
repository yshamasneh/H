import { useEffect, useState } from "react";
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

export function InventoryWorkspace() {
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
      setNotice(`Barcode matched ${item.name}.`);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color="#0F766E" size="large" /></View>;

  const summary = inventory?.summary;
  return (
    <View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.success}>{notice}</Text> : null}

      <View style={styles.summaryGrid}>
        <Summary label="Products" value={summary?.totalProducts ?? 0} />
        <Summary label="Tracked" value={summary?.trackedProducts ?? 0} />
        <Summary label="Low stock" value={summary?.lowStockProducts ?? 0} alert />
        <Summary label="Out" value={summary?.outOfStockProducts ?? 0} alert />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Find inventory</Text>
        <Field label="Search product, SKU, brand or barcode" value={search} onChangeText={setSearch} />
        <View style={styles.row}>
          <Button disabled={busy} label="Search" onPress={() => void load(search, lowStockOnly)} />
          <Button
            disabled={busy}
            label={lowStockOnly ? "Show all" : "Low stock only"}
            onPress={() => {
              const next = !lowStockOnly;
              setLowStockOnly(next);
              void load(search, next);
            }}
            secondary
          />
        </View>
        <Field label="Barcode lookup / scanner input" value={barcode} onChangeText={setBarcode} keyboardType="number-pad" />
        <Button disabled={busy || !barcode.trim()} label="Look up barcode" onPress={() => void findBarcode()} secondary />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Manual stock adjustment</Text>
        <ItemPicker items={inventory?.items ?? []} selectedId={selectedItemId} onSelect={setSelectedItemId} />
        <Field label="Change (+ receive / - remove)" value={adjustment} onChangeText={setAdjustment} keyboardType="numbers-and-punctuation" />
        <Field label="Reason" value={adjustmentReason} onChangeText={setAdjustmentReason} />
        <Button
          disabled={busy || !selectedItemId || !adjustment.trim() || adjustmentReason.trim().length < 2}
          label="Apply adjustment"
          onPress={() => void run(
            (token) => adjustStoreInventory(token, selectedItemId, Number.parseInt(adjustment, 10), adjustmentReason.trim()),
            "Inventory adjusted and logged."
          ).then(() => { setAdjustment(""); setAdjustmentReason(""); })}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Products</Text>
        {(inventory?.items ?? []).map((item) => (
          <Pressable key={item.id} onPress={() => setSelectedItemId(item.id)} style={[styles.itemCard, item.isLowStock && styles.lowStockCard]}>
            <View style={styles.itemCopy}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.meta}>{item.sku ?? "No SKU"}{item.barcode ? ` · ${item.barcode}` : ""}</Text>
            </View>
            <Text style={[styles.stock, item.isLowStock && styles.stockAlert]}>
              {item.stockQuantity === null ? "Untracked" : `${item.stockQuantity} ${item.unitLabel}`}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Suppliers</Text>
        <Field label="Supplier name" value={supplierName} onChangeText={setSupplierName} />
        <Field label="Phone (optional)" value={supplierPhone} onChangeText={setSupplierPhone} keyboardType="phone-pad" />
        <Button
          disabled={busy || supplierName.trim().length < 2}
          label="Add supplier"
          onPress={() => void run(
            (token) => createStoreSupplier(token, { name: supplierName.trim(), phone: supplierPhone.trim() || undefined }),
            "Supplier added."
          ).then(() => { setSupplierName(""); setSupplierPhone(""); })}
        />
        {suppliers.map((supplier) => <Text key={supplier.id} style={styles.listLine}>{supplier.name}{supplier.phone ? ` · ${supplier.phone}` : ""}</Text>)}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>New purchase order</Text>
        <Text style={styles.label}>Supplier</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.picker}>
          {suppliers.map((supplier) => <Chip key={supplier.id} active={purchaseSupplierId === supplier.id} label={supplier.name} onPress={() => setPurchaseSupplierId(supplier.id)} />)}
        </ScrollView>
        <Text style={styles.label}>Product</Text>
        <ItemPicker items={inventory?.items ?? []} selectedId={purchaseItemId} onSelect={setPurchaseItemId} />
        <Field label="Quantity" value={purchaseQuantity} onChangeText={setPurchaseQuantity} keyboardType="number-pad" />
        <Field label="Unit cost (ILS)" value={purchaseUnitCost} onChangeText={setPurchaseUnitCost} keyboardType="decimal-pad" />
        <Field label="Supplier reference (optional)" value={purchaseReference} onChangeText={setPurchaseReference} />
        <Button
          disabled={busy || !purchaseSupplierId || !purchaseItemId || Number.parseInt(purchaseQuantity, 10) < 1}
          label="Create draft purchase"
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
            "Draft purchase order created."
          ).then(() => { setPurchaseQuantity(""); setPurchaseUnitCost(""); setPurchaseReference(""); })}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Purchase orders</Text>
        {purchaseOrders.length === 0 ? <Text style={styles.meta}>No purchase orders yet.</Text> : null}
        {purchaseOrders.map((order) => (
          <View key={order.id} style={styles.purchaseCard}>
            <Text style={styles.itemName}>{order.reference ?? `Purchase ${order.id.slice(0, 8)}`}</Text>
            <Text style={styles.meta}>{order.supplier.name} · {order.status} · {formatMoney(order.totalCostMinor)}</Text>
            {order.items.map((line) => <Text key={line.id} style={styles.listLine}>{line.quantity} × {line.menuItem.name}</Text>)}
            {order.status === "DRAFT" ? (
              <View style={styles.row}>
                <Button disabled={busy} label="Receive stock" onPress={() => void run((token) => receiveStorePurchaseOrder(token, order.id), "Purchase received into stock.")} />
                <Button disabled={busy} label="Cancel" onPress={() => void run((token) => cancelStorePurchaseOrder(token, order.id), "Purchase order cancelled.")} secondary />
              </View>
            ) : null}
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Recent stock movements</Text>
        {movements.map((movement) => (
          <View key={movement.id} style={styles.movementRow}>
            <View style={styles.itemCopy}>
              <Text style={styles.itemName}>{movement.menuItem.name}</Text>
              <Text style={styles.meta}>{movement.type.replaceAll("_", " ")} · {movement.reason ?? "System movement"}</Text>
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

async function requireToken() { const token = await getAccessToken(); if (!token) throw new Error("Your session has expired."); return token; }
function readError(error: unknown) { return error instanceof ApiError || error instanceof Error ? error.message : "The request could not be completed."; }
function formatMoney(minor: number) { return `${(minor / 100).toFixed(2)} ILS`; }

const styles = StyleSheet.create({
  center: { alignItems: "center", padding: 40 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 20, marginBottom: 16, padding: 18 },
  cardTitle: { color: "#102A2A", fontSize: 18, fontWeight: "900", marginBottom: 15 },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  summaryCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 14, flexBasis: "47%", flexGrow: 1, padding: 13 },
  summaryAlert: { backgroundColor: "#FEF2F2" },
  summaryValue: { color: "#0F766E", fontSize: 22, fontWeight: "900" },
  field: { marginBottom: 13 },
  label: { color: "#334155", fontSize: 12, fontWeight: "800", marginBottom: 7 },
  input: { backgroundColor: "#F8FAFC", borderColor: "#DCE5E4", borderRadius: 12, borderWidth: 1, color: "#102A2A", minHeight: 48, paddingHorizontal: 13 },
  row: { flexDirection: "row", gap: 8, marginBottom: 10 },
  button: { alignItems: "center", backgroundColor: "#0F766E", borderRadius: 12, flex: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: 12 },
  buttonSecondary: { backgroundColor: "#E7F4F1" },
  buttonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900", textAlign: "center" },
  buttonTextSecondary: { color: "#0F766E" },
  disabled: { opacity: 0.45 },
  picker: { marginBottom: 14 },
  chip: { backgroundColor: "#F1F5F9", borderRadius: 999, marginRight: 7, paddingHorizontal: 12, paddingVertical: 9 },
  chipActive: { backgroundColor: "#0F766E" },
  chipText: { color: "#475569", fontSize: 11, fontWeight: "800" },
  chipTextActive: { color: "#FFFFFF" },
  itemCard: { alignItems: "center", borderBottomColor: "#E2E8F0", borderBottomWidth: 1, flexDirection: "row", paddingVertical: 12 },
  lowStockCard: { backgroundColor: "#FFF7ED", marginHorizontal: -8, paddingHorizontal: 8 },
  itemCopy: { flex: 1, paddingRight: 8 },
  itemName: { color: "#102A2A", fontSize: 13, fontWeight: "900" },
  meta: { color: "#64748B", fontSize: 10, lineHeight: 15, marginTop: 3 },
  stock: { color: "#15803D", fontSize: 12, fontWeight: "900" },
  stockAlert: { color: "#B91C1C" },
  listLine: { color: "#475569", fontSize: 11, marginTop: 8 },
  purchaseCard: { borderColor: "#E2E8F0", borderRadius: 14, borderWidth: 1, marginTop: 10, padding: 13 },
  movementRow: { alignItems: "center", borderBottomColor: "#E2E8F0", borderBottomWidth: 1, flexDirection: "row", paddingVertical: 11 },
  error: { backgroundColor: "#FEE2E2", borderRadius: 12, color: "#B91C1C", marginBottom: 12, padding: 12 },
  success: { backgroundColor: "#DCFCE7", borderRadius: 12, color: "#166534", marginBottom: 12, padding: 12 }
});
