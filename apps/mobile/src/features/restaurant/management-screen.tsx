import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ApiError,
  createRestaurantMenuCategory,
  createRestaurantMenuItem,
  getRestaurantOwnerProfile,
  listRestaurantMenuCategories,
  listRestaurantMenuItems,
  setRestaurantMenuItemAvailability,
  setRestaurantOpenStatus,
  updateRestaurantMenuCategory,
  updateRestaurantMenuItem,
  updateRestaurantOwnerProfile,
  type MenuCategoryOwner,
  type MenuItemOwner,
  type RestaurantOwnerProfile
} from "../../core/api";
import { getAccessToken } from "../../core/session";
import { getCurrentCoordinates } from "../../core/location";
import { InventoryWorkspace } from "./inventory-screen";

type Section = "profile" | "categories" | "items" | "inventory";

export function RestaurantManagementScreen({ onBack }: { onBack: () => void }) {
  const [profile, setProfile] = useState<RestaurantOwnerProfile | null>(null);
  const [categories, setCategories] = useState<MenuCategoryOwner[]>([]);
  const [items, setItems] = useState<MenuItemOwner[]>([]);
  const [section, setSection] = useState<Section>("profile");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const token = await requireToken();
      const [nextProfile, nextCategories, nextItems] = await Promise.all([
        getRestaurantOwnerProfile(token),
        listRestaurantMenuCategories(token),
        listRestaurantMenuItems(token)
      ]);
      setProfile(nextProfile);
      setCategories(nextCategories);
      setItems(nextItems);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function run(action: (token: string) => Promise<void>, successMessage: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action(await requireToken());
      setNotice(successMessage);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backText}>Back</Text></Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{profile?.businessType === "SUPERMARKET" ? "Supermarket workspace" : "Restaurant workspace"}</Text>
          <Text style={styles.subtitle}>{profile?.businessType === "SUPERMARKET" ? "Profile, departments and product inventory" : "Profile, categories and menu items"}</Text>
        </View>
      </View>
      <View style={styles.tabs}>
        {(profile?.businessType === "SUPERMARKET"
          ? ["profile", "categories", "items", "inventory"] as const
          : ["profile", "categories", "items"] as const
        ).map((value) => (
          <Pressable
            key={value}
            onPress={() => setSection(value)}
            style={[styles.tab, section === value && styles.tabActive]}
          >
            <Text style={[styles.tabText, section === value && styles.tabTextActive]}>{titleCase(value)}</Text>
          </Pressable>
        ))}
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#0F766E" size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {error ? <Message tone="error" text={error} /> : null}
          {notice ? <Message tone="success" text={notice} /> : null}
          {section === "profile" && profile ? (
            <ProfileSection
              busy={busy}
              profile={profile}
              onSave={(input) =>
                run(async (token) => setProfile(await updateRestaurantOwnerProfile(token, input)), "Profile saved.")
              }
              onToggleOpen={() =>
                run(
                  async (token) => setProfile(await setRestaurantOpenStatus(token, !profile.isOpen)),
                  profile.isOpen ? "Store closed for new orders." : "Store opened for new orders."
                )
              }
            />
          ) : null}
          {section === "categories" ? (
            <CategoriesSection
              busy={busy}
              categories={categories}
              onCreate={(name, sortOrder) =>
                run(async (token) => {
                  const created = await createRestaurantMenuCategory(token, { name, sortOrder });
                  setCategories((current) => [...current, created].sort((a, b) => a.sortOrder - b.sortOrder));
                }, "Category created.")
              }
              onToggle={(category) =>
                run(async (token) => {
                  const updated = await updateRestaurantMenuCategory(token, category.id, {
                    isActive: !category.isActive
                  });
                  setCategories((current) => current.map((item) => item.id === updated.id ? updated : item));
                }, category.isActive ? "Category hidden." : "Category activated.")
              }
            />
          ) : null}
          {section === "items" ? (
            <ItemsSection
              businessType={profile?.businessType ?? "RESTAURANT"}
              busy={busy}
              categories={categories}
              items={items}
              onSave={(draft, editingId) =>
                run(async (token) => {
                  const saved = editingId
                    ? await updateRestaurantMenuItem(token, editingId, draft)
                    : await createRestaurantMenuItem(token, draft);
                  setItems((current) => {
                    const exists = current.some((item) => item.id === saved.id);
                    return (exists ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved])
                      .sort((a, b) => a.name.localeCompare(b.name));
                  });
                }, editingId ? "Menu item updated." : "Menu item created.")
              }
              onToggle={(item) =>
                run(async (token) => {
                  const updated = await setRestaurantMenuItemAvailability(token, item.id, !item.isAvailable);
                  setItems((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate));
                }, item.isAvailable ? "Item marked unavailable." : "Item is available again.")
              }
            />
          ) : null}
          {section === "inventory" && profile?.businessType === "SUPERMARKET" ? (
            <InventoryWorkspace />
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ProfileSection(props: {
  profile: RestaurantOwnerProfile;
  busy: boolean;
  onSave: (input: { name: string; description: string; addressLine: string; logoUrl: string; latitude?: number; longitude?: number }) => void;
  onToggleOpen: () => void;
}) {
  const [name, setName] = useState(props.profile.name);
  const [description, setDescription] = useState(props.profile.description ?? "");
  const [addressLine, setAddressLine] = useState(props.profile.addressLine);
  const [logoUrl, setLogoUrl] = useState(props.profile.logoUrl ?? "");
  const [latitude, setLatitude] = useState<number | null>(props.profile.latitude);
  const [longitude, setLongitude] = useState<number | null>(props.profile.longitude);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  async function useCurrentLocation() {
    setLocating(true);
    setLocationError(null);
    try {
      const coordinates = await getCurrentCoordinates();
      setLatitude(coordinates.latitude);
      setLongitude(coordinates.longitude);
    } catch (requestError) {
      setLocationError(readError(requestError));
    } finally {
      setLocating(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.statusRow}>
        <StatusPill value={props.profile.status} />
        <Text style={[styles.openState, props.profile.isOpen && styles.openStateActive]}>
          {props.profile.isOpen ? "Accepting orders" : "Closed"}
        </Text>
      </View>
      {props.profile.status !== "APPROVED" ? (
        <Text style={styles.pendingNote}>You can prepare the profile and menu now. Customers see it only after approval.</Text>
      ) : null}
      <Field label={props.profile.businessType === "SUPERMARKET" ? "Supermarket name" : "Restaurant name"} value={name} onChangeText={setName} />
      <Field label="Description" value={description} onChangeText={setDescription} multiline />
      <Field label="Address" value={addressLine} onChangeText={setAddressLine} multiline />
      <Field label="Logo URL (optional)" value={logoUrl} onChangeText={setLogoUrl} />
      <Text style={styles.locationNote}>
        {latitude !== null && longitude !== null
          ? `Delivery origin: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
          : "Set the store pin before opening. It is used to calculate delivery distance."}
      </Text>
      {locationError ? <Text style={styles.locationError}>{locationError}</Text> : null}
      <ActionButton
        disabled={props.busy || locating}
        label={locating ? "Finding location..." : "Use current location as store pin"}
        onPress={() => void useCurrentLocation()}
        secondary
      />
      <ActionButton
        disabled={props.busy || name.trim().length < 2 || addressLine.trim().length < 3}
        label="Save profile"
        onPress={() => props.onSave({
          name: name.trim(),
          description: description.trim(),
          addressLine: addressLine.trim(),
          logoUrl: logoUrl.trim(),
          latitude: latitude ?? undefined,
          longitude: longitude ?? undefined
        })}
      />
      <ActionButton
        disabled={props.busy || props.profile.status !== "APPROVED" || latitude === null || longitude === null}
        label={props.profile.isOpen ? "Close store" : "Open store"}
        onPress={props.onToggleOpen}
        secondary
      />
    </View>
  );
}

function CategoriesSection(props: {
  categories: MenuCategoryOwner[];
  busy: boolean;
  onCreate: (name: string, sortOrder: number) => void;
  onToggle: (category: MenuCategoryOwner) => void;
}) {
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>New category</Text>
        <Field label="Name" value={name} onChangeText={setName} />
        <Field label="Sort order" value={sortOrder} onChangeText={setSortOrder} keyboardType="number-pad" />
        <ActionButton
          disabled={props.busy || name.trim().length < 1}
          label="Add category"
          onPress={() => {
            props.onCreate(name.trim(), Math.max(0, Number.parseInt(sortOrder, 10) || 0));
            setName("");
            setSortOrder("0");
          }}
        />
      </View>
      {props.categories.length === 0 ? <Empty text="Add a category before creating menu items." /> : null}
      {props.categories.map((category) => (
        <View key={category.id} style={styles.listCard}>
          <View style={styles.listCopy}>
            <Text style={styles.listTitle}>{category.name}</Text>
            <Text style={styles.listMeta}>Order {category.sortOrder} · {category.isActive ? "Visible" : "Hidden"}</Text>
          </View>
          <SmallButton
            disabled={props.busy}
            label={category.isActive ? "Hide" : "Activate"}
            onPress={() => props.onToggle(category)}
          />
        </View>
      ))}
    </>
  );
}

type ItemDraft = {
  categoryId: string;
  name: string;
  description?: string;
  priceMinor: number;
  imageUrl?: string;
  sku?: string;
  brand?: string;
  unitLabel?: string;
  stockQuantity?: number | null;
  isFeatured?: boolean;
  isVariableWeight?: boolean;
  barcode?: string;
  reorderLevel?: number | null;
};

function ItemsSection(props: {
  businessType: "RESTAURANT" | "SUPERMARKET";
  categories: MenuCategoryOwner[];
  items: MenuItemOwner[];
  busy: boolean;
  onSave: (draft: ItemDraft, editingId: string | null) => void;
  onToggle: (item: MenuItemOwner) => void;
}) {
  const activeCategories = useMemo(() => props.categories.filter((category) => category.isActive), [props.categories]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState(activeCategories[0]?.id ?? props.categories[0]?.id ?? "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [sku, setSku] = useState("");
  const [brand, setBrand] = useState("");
  const [unitLabel, setUnitLabel] = useState("item");
  const [stockQuantity, setStockQuantity] = useState("");
  const [isFeatured, setIsFeatured] = useState(false);
  const [isVariableWeight, setIsVariableWeight] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [reorderLevel, setReorderLevel] = useState("");
  const priceMinor = Math.round(Number(price.replace(",", ".")) * 100);

  function reset() {
    setEditingId(null);
    setName("");
    setDescription("");
    setPrice("");
    setImageUrl("");
    setSku("");
    setBrand("");
    setUnitLabel("item");
    setStockQuantity("");
    setIsFeatured(false);
    setIsVariableWeight(false);
    setBarcode("");
    setReorderLevel("");
  }

  function edit(item: MenuItemOwner) {
    setEditingId(item.id);
    setCategoryId(item.categoryId);
    setName(item.name);
    setDescription(item.description ?? "");
    setPrice((item.priceMinor / 100).toFixed(2));
    setImageUrl(item.imageUrl ?? "");
    setSku(item.sku ?? "");
    setBrand(item.brand ?? "");
    setUnitLabel(item.unitLabel);
    setStockQuantity(item.stockQuantity === null ? "" : String(item.stockQuantity));
    setIsFeatured(item.isFeatured);
    setIsVariableWeight(item.isVariableWeight);
    setBarcode(item.barcode ?? "");
    setReorderLevel(item.reorderLevel === null ? "" : String(item.reorderLevel));
  }

  if (props.categories.length === 0) return <Empty text="Create a category first, then add menu items." />;

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {editingId ? "Edit" : "New"} {props.businessType === "SUPERMARKET" ? "product" : "menu item"}
        </Text>
        <Text style={styles.label}>{props.businessType === "SUPERMARKET" ? "Department" : "Category"}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryPicker}>
          {props.categories.map((category) => (
            <Pressable
              key={category.id}
              onPress={() => setCategoryId(category.id)}
              style={[styles.categoryChip, categoryId === category.id && styles.categoryChipActive]}
            >
              <Text style={[styles.categoryChipText, categoryId === category.id && styles.categoryChipTextActive]}>
                {category.name}{category.isActive ? "" : " (hidden)"}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <Field label={props.businessType === "SUPERMARKET" ? "Product name" : "Item name"} value={name} onChangeText={setName} />
        <Field label="Description" value={description} onChangeText={setDescription} multiline />
        <Field label="Price (ILS)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
        <Field label="Image URL (optional)" value={imageUrl} onChangeText={setImageUrl} />
        {props.businessType === "SUPERMARKET" ? (
          <>
            <Field label="Brand (optional)" value={brand} onChangeText={setBrand} />
            <Field label="SKU (optional, unique in this store)" value={sku} onChangeText={setSku} />
            <Field label="Selling unit (for example: 1 L bottle)" value={unitLabel} onChangeText={setUnitLabel} />
            <Field label="Stock quantity (blank means not tracked)" value={stockQuantity} onChangeText={setStockQuantity} keyboardType="number-pad" />
            <Field label="Barcode (optional)" value={barcode} onChangeText={setBarcode} keyboardType="number-pad" />
            <Field label="Low-stock alert at (optional)" value={reorderLevel} onChangeText={setReorderLevel} keyboardType="number-pad" />
            <Pressable
              onPress={() => setIsFeatured((current) => !current)}
              style={[styles.featuredToggle, isFeatured && styles.featuredToggleActive]}
            >
              <Text style={[styles.featuredToggleText, isFeatured && styles.featuredToggleTextActive]}>
                {isFeatured ? "✓ Featured product" : "Mark as featured"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setIsVariableWeight((current) => !current)}
              style={[styles.featuredToggle, isVariableWeight && styles.featuredToggleActive]}
            >
              <Text style={[styles.featuredToggleText, isVariableWeight && styles.featuredToggleTextActive]}>
                {isVariableWeight ? "✓ Variable packed weight/quantity" : "Fixed selling quantity"}
              </Text>
            </Pressable>
          </>
        ) : null}
        <ActionButton
          disabled={props.busy || !categoryId || name.trim().length < 1 || !Number.isFinite(priceMinor) || priceMinor < 0}
          label={editingId ? "Save changes" : "Add item"}
          onPress={() => {
            props.onSave({
              categoryId,
              name: name.trim(),
              description: description.trim() || undefined,
              priceMinor,
              imageUrl: imageUrl.trim() || undefined,
              sku: props.businessType === "SUPERMARKET" ? sku.trim() || undefined : undefined,
              brand: props.businessType === "SUPERMARKET" ? brand.trim() || undefined : undefined,
              unitLabel: props.businessType === "SUPERMARKET" ? unitLabel.trim() || "item" : undefined,
              stockQuantity: props.businessType === "SUPERMARKET"
                ? stockQuantity.trim()
                  ? Math.max(0, Number.parseInt(stockQuantity, 10) || 0)
                  : editingId ? null : undefined
                : undefined,
              isFeatured: props.businessType === "SUPERMARKET" ? isFeatured : undefined,
              isVariableWeight: props.businessType === "SUPERMARKET" ? isVariableWeight : undefined,
              barcode: props.businessType === "SUPERMARKET" ? barcode.trim() || undefined : undefined,
              reorderLevel: props.businessType === "SUPERMARKET"
                ? reorderLevel.trim() ? Math.max(0, Number.parseInt(reorderLevel, 10) || 0) : editingId ? null : undefined
                : undefined
            }, editingId);
            reset();
          }}
        />
        {editingId ? <ActionButton label="Cancel editing" onPress={reset} secondary /> : null}
      </View>
      {props.items.length === 0 ? <Empty text={props.businessType === "SUPERMARKET" ? "No products yet." : "No menu items yet."} /> : null}
      {props.items.map((item) => (
        <View key={item.id} style={styles.listCard}>
          <View style={styles.listCopy}>
            <Text style={styles.listTitle}>{item.name}</Text>
            <Text style={styles.listMeta}>
              {formatPrice(item.priceMinor)} · {item.unitLabel} · {item.isAvailable ? "Available" : "Unavailable"}
              {item.stockQuantity === null ? "" : ` · Stock ${item.stockQuantity}`}{item.isFeatured ? " · Featured" : ""}
            </Text>
          </View>
          <View style={styles.itemActions}>
            <SmallButton disabled={props.busy} label="Edit" onPress={() => edit(item)} />
            <SmallButton
              disabled={props.busy}
              label={item.isAvailable ? "Pause" : "Resume"}
              onPress={() => props.onToggle(item)}
            />
          </View>
        </View>
      ))}
    </>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  keyboardType?: "default" | "number-pad" | "decimal-pad";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        keyboardType={props.keyboardType}
        multiline={props.multiline}
        onChangeText={props.onChangeText}
        style={[styles.input, props.multiline && styles.multilineInput]}
        value={props.value}
      />
    </View>
  );
}

function ActionButton(props: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return (
    <Pressable
      disabled={props.disabled}
      onPress={props.onPress}
      style={[styles.actionButton, props.secondary && styles.actionButtonSecondary, props.disabled && styles.disabled]}
    >
      <Text style={[styles.actionText, props.secondary && styles.actionTextSecondary]}>{props.label}</Text>
    </Pressable>
  );
}

function SmallButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable disabled={props.disabled} onPress={props.onPress} style={[styles.smallButton, props.disabled && styles.disabled]}>
      <Text style={styles.smallButtonText}>{props.label}</Text>
    </Pressable>
  );
}

function StatusPill({ value }: { value: string }) {
  return <View style={styles.statusPill}><Text style={styles.statusText}>{value.replaceAll("_", " ")}</Text></View>;
}

function Message({ tone, text }: { tone: "error" | "success"; text: string }) {
  return <Text style={[styles.message, tone === "error" ? styles.error : styles.success]}>{text}</Text>;
}

function Empty({ text }: { text: string }) {
  return <View style={styles.empty}><Text style={styles.emptyText}>{text}</Text></View>;
}

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error("Your session has expired. Please log in again.");
  return token;
}

function readError(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : "The request could not be completed.";
}

function formatPrice(minor: number): string {
  return `${(minor / 100).toFixed(2)} ILS`;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#F5FAFC", flex: 1 },
  header: { alignItems: "center", flexDirection: "row", paddingHorizontal: 18, paddingTop: 12 },
  backButton: { backgroundColor: "#FFFFFF", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  backText: { color: "#0F766E", fontWeight: "900" },
  headerCopy: { flex: 1, marginLeft: 14 },
  title: { color: "#102A2A", fontSize: 22, fontWeight: "900" },
  subtitle: { color: "#64748B", fontSize: 12, marginTop: 2 },
  tabs: { flexDirection: "row", gap: 7, padding: 18, paddingBottom: 8 },
  tab: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 12, flex: 1, padding: 11 },
  tabActive: { backgroundColor: "#0F766E" },
  tabText: { color: "#64748B", fontSize: 12, fontWeight: "800" },
  tabTextActive: { color: "#FFFFFF" },
  center: { alignItems: "center", flex: 1, justifyContent: "center" },
  content: { alignSelf: "center", maxWidth: 760, padding: 18, paddingBottom: 50, width: "100%" },
  card: { backgroundColor: "#FFFFFF", borderRadius: 20, marginBottom: 16, padding: 18 },
  cardTitle: { color: "#102A2A", fontSize: 18, fontWeight: "900", marginBottom: 16 },
  statusRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  statusPill: { backgroundColor: "#FFF2D8", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  statusText: { color: "#9A6700", fontSize: 11, fontWeight: "900" },
  openState: { color: "#B91C1C", fontSize: 12, fontWeight: "900" },
  openStateActive: { color: "#15803D" },
  pendingNote: { backgroundColor: "#EFF6FF", borderRadius: 12, color: "#1D4ED8", lineHeight: 18, marginBottom: 16, padding: 12 },
  locationNote: { backgroundColor: "#F0FDFA", borderRadius: 12, color: "#115E59", fontSize: 12, lineHeight: 18, padding: 12 },
  locationError: { color: "#B91C1C", fontSize: 12, marginTop: 7 },
  field: { marginBottom: 14 },
  label: { color: "#334155", fontSize: 12, fontWeight: "800", marginBottom: 7 },
  input: { backgroundColor: "#F8FAFC", borderColor: "#DCE5E4", borderRadius: 12, borderWidth: 1, color: "#102A2A", minHeight: 48, paddingHorizontal: 13 },
  multilineInput: { minHeight: 78, paddingTop: 12, textAlignVertical: "top" },
  actionButton: { alignItems: "center", backgroundColor: "#0F766E", borderRadius: 13, justifyContent: "center", marginTop: 4, minHeight: 48, paddingHorizontal: 15 },
  actionButtonSecondary: { backgroundColor: "#E7F4F1", marginTop: 9 },
  actionText: { color: "#FFFFFF", fontWeight: "900" },
  actionTextSecondary: { color: "#0F766E" },
  disabled: { opacity: 0.45 },
  listCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 16, flexDirection: "row", marginBottom: 10, padding: 15 },
  listCopy: { flex: 1, paddingRight: 10 },
  listTitle: { color: "#102A2A", fontSize: 15, fontWeight: "900" },
  listMeta: { color: "#64748B", fontSize: 11, marginTop: 5 },
  itemActions: { gap: 6 },
  smallButton: { backgroundColor: "#E7F4F1", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  smallButtonText: { color: "#0F766E", fontSize: 11, fontWeight: "900" },
  categoryPicker: { marginBottom: 14 },
  categoryChip: { backgroundColor: "#F1F5F9", borderRadius: 999, marginRight: 8, paddingHorizontal: 13, paddingVertical: 9 },
  categoryChipActive: { backgroundColor: "#0F766E" },
  categoryChipText: { color: "#475569", fontSize: 11, fontWeight: "800" },
  categoryChipTextActive: { color: "#FFFFFF" },
  featuredToggle: { alignItems: "center", backgroundColor: "#F8FAFC", borderColor: "#DCE5E4", borderRadius: 12, borderWidth: 1, marginBottom: 14, padding: 13 },
  featuredToggleActive: { backgroundColor: "#DCFCE7", borderColor: "#15803D" },
  featuredToggleText: { color: "#64748B", fontSize: 12, fontWeight: "800" },
  featuredToggleTextActive: { color: "#166534" },
  message: { borderRadius: 12, marginBottom: 12, padding: 12 },
  error: { backgroundColor: "#FEE2E2", color: "#B91C1C" },
  success: { backgroundColor: "#DCFCE7", color: "#166534" },
  empty: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 24 },
  emptyText: { color: "#64748B", textAlign: "center" }
});
