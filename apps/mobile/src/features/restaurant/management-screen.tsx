import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import i18n from "../../i18n";
import { LanguageSwitcher } from "../../i18n/LanguageSwitcher";
import { InventoryWorkspace } from "./inventory-screen";

type Section = "profile" | "categories" | "items" | "inventory";

const tabLabelKeys: Record<Section, string> = {
  profile: "management.tabProfile",
  categories: "management.tabCategories",
  items: "management.tabItems",
  inventory: "management.tabInventory"
};

export function RestaurantManagementScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation(["restaurantOps", "common"]);
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
        <Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backText}>{t("common:back")}</Text></Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>
            {profile?.businessType === "SUPERMARKET" ? t("management.supermarketWorkspaceTitle") : t("management.restaurantWorkspaceTitle")}
          </Text>
          <Text style={styles.subtitle}>
            {profile?.businessType === "SUPERMARKET" ? t("management.supermarketWorkspaceSubtitle") : t("management.restaurantWorkspaceSubtitle")}
          </Text>
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
            <Text style={[styles.tabText, section === value && styles.tabTextActive]}>{t(tabLabelKeys[value])}</Text>
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
                run(async (token) => setProfile(await updateRestaurantOwnerProfile(token, input)), t("management.profileSavedNotice"))
              }
              onToggleOpen={() =>
                run(
                  async (token) => setProfile(await setRestaurantOpenStatus(token, !profile.isOpen)),
                  profile.isOpen ? t("management.storeClosedNotice") : t("management.storeOpenedNotice")
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
                }, t("management.categoryCreatedNotice"))
              }
              onToggle={(category) =>
                run(async (token) => {
                  const updated = await updateRestaurantMenuCategory(token, category.id, {
                    isActive: !category.isActive
                  });
                  setCategories((current) => current.map((item) => item.id === updated.id ? updated : item));
                }, category.isActive ? t("management.categoryHiddenNotice") : t("management.categoryActivatedNotice"))
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
                }, editingId ? t("management.menuItemUpdatedNotice") : t("management.menuItemCreatedNotice"))
              }
              onToggle={(item) =>
                run(async (token) => {
                  const updated = await setRestaurantMenuItemAvailability(token, item.id, !item.isAvailable);
                  setItems((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate));
                }, item.isAvailable ? t("management.itemUnavailableNotice") : t("management.itemAvailableNotice"))
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
  const { t } = useTranslation(["restaurantOps"]);
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
          {props.profile.isOpen ? t("management.acceptingOrders") : t("management.closedState")}
        </Text>
      </View>
      {props.profile.status !== "APPROVED" ? (
        <Text style={styles.pendingNote}>{t("management.pendingApprovalNote")}</Text>
      ) : null}
      <Field
        label={props.profile.businessType === "SUPERMARKET" ? t("management.supermarketNameLabel") : t("management.restaurantNameLabel")}
        value={name}
        onChangeText={setName}
      />
      <Field label={t("management.descriptionLabel")} value={description} onChangeText={setDescription} multiline />
      <Field label={t("management.addressLabel")} value={addressLine} onChangeText={setAddressLine} multiline />
      <Field label={t("management.logoUrlLabel")} value={logoUrl} onChangeText={setLogoUrl} />
      <Text style={styles.locationNote}>
        {latitude !== null && longitude !== null
          ? t("management.deliveryOriginNote", { lat: latitude.toFixed(5), lng: longitude.toFixed(5) })
          : t("management.setStorePinNote")}
      </Text>
      {locationError ? <Text style={styles.locationError}>{locationError}</Text> : null}
      <ActionButton
        disabled={props.busy || locating}
        label={locating ? t("management.findingLocation") : t("management.useCurrentLocationAsPin")}
        onPress={() => void useCurrentLocation()}
        secondary
      />
      <ActionButton
        disabled={props.busy || name.trim().length < 2 || addressLine.trim().length < 3}
        label={t("management.saveProfileButton")}
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
        label={props.profile.isOpen ? t("management.closeStoreButton") : t("management.openStoreButton")}
        onPress={props.onToggleOpen}
        secondary
      />
      <LanguageSwitcher />
    </View>
  );
}

function CategoriesSection(props: {
  categories: MenuCategoryOwner[];
  busy: boolean;
  onCreate: (name: string, sortOrder: number) => void;
  onToggle: (category: MenuCategoryOwner) => void;
}) {
  const { t } = useTranslation(["restaurantOps"]);
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("management.newCategoryTitle")}</Text>
        <Field label={t("management.categoryNameLabel")} value={name} onChangeText={setName} />
        <Field label={t("management.sortOrderLabel")} value={sortOrder} onChangeText={setSortOrder} keyboardType="number-pad" />
        <ActionButton
          disabled={props.busy || name.trim().length < 1}
          label={t("management.addCategoryButton")}
          onPress={() => {
            props.onCreate(name.trim(), Math.max(0, Number.parseInt(sortOrder, 10) || 0));
            setName("");
            setSortOrder("0");
          }}
        />
      </View>
      {props.categories.length === 0 ? <Empty text={t("management.addCategoryFirstEmpty")} /> : null}
      {props.categories.map((category) => (
        <View key={category.id} style={styles.listCard}>
          <View style={styles.listCopy}>
            <Text style={styles.listTitle}>{category.name}</Text>
            <Text style={styles.listMeta}>
              {t("management.orderVisibility", {
                order: category.sortOrder,
                visibility: category.isActive ? t("management.visibleLabel") : t("management.hiddenLabel")
              })}
            </Text>
          </View>
          <SmallButton
            disabled={props.busy}
            label={category.isActive ? t("management.hideButton") : t("management.activateButton")}
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
  const { t } = useTranslation(["restaurantOps"]);
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

  if (props.categories.length === 0) return <Empty text={t("management.createCategoryFirstEmpty")} />;

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {editingId ? t("management.editItemPrefix") : t("management.newItemPrefix")}{" "}
          {props.businessType === "SUPERMARKET" ? t("management.productWord") : t("management.menuItemWord")}
        </Text>
        <Text style={styles.label}>{props.businessType === "SUPERMARKET" ? t("management.departmentLabel") : t("management.categoryLabel")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryPicker}>
          {props.categories.map((category) => (
            <Pressable
              key={category.id}
              onPress={() => setCategoryId(category.id)}
              style={[styles.categoryChip, categoryId === category.id && styles.categoryChipActive]}
            >
              <Text style={[styles.categoryChipText, categoryId === category.id && styles.categoryChipTextActive]}>
                {category.name}{category.isActive ? "" : t("management.hiddenSuffix")}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <Field label={props.businessType === "SUPERMARKET" ? t("management.productNameLabel") : t("management.itemNameLabel")} value={name} onChangeText={setName} />
        <Field label={t("management.descriptionLabel")} value={description} onChangeText={setDescription} multiline />
        <Field label={t("management.priceLabel")} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
        <Field label={t("management.imageUrlLabel")} value={imageUrl} onChangeText={setImageUrl} />
        {props.businessType === "SUPERMARKET" ? (
          <>
            <Field label={t("management.brandLabel")} value={brand} onChangeText={setBrand} />
            <Field label={t("management.skuLabel")} value={sku} onChangeText={setSku} />
            <Field label={t("management.sellingUnitLabel")} value={unitLabel} onChangeText={setUnitLabel} />
            <Field label={t("management.stockQuantityLabel")} value={stockQuantity} onChangeText={setStockQuantity} keyboardType="number-pad" />
            <Field label={t("management.barcodeLabel")} value={barcode} onChangeText={setBarcode} keyboardType="number-pad" />
            <Field label={t("management.reorderLevelLabel")} value={reorderLevel} onChangeText={setReorderLevel} keyboardType="number-pad" />
            <Pressable
              onPress={() => setIsFeatured((current) => !current)}
              style={[styles.featuredToggle, isFeatured && styles.featuredToggleActive]}
            >
              <Text style={[styles.featuredToggleText, isFeatured && styles.featuredToggleTextActive]}>
                {isFeatured ? t("management.featuredActive") : t("management.markFeatured")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setIsVariableWeight((current) => !current)}
              style={[styles.featuredToggle, isVariableWeight && styles.featuredToggleActive]}
            >
              <Text style={[styles.featuredToggleText, isVariableWeight && styles.featuredToggleTextActive]}>
                {isVariableWeight ? t("management.variableWeightActive") : t("management.fixedQuantity")}
              </Text>
            </Pressable>
          </>
        ) : null}
        <ActionButton
          disabled={props.busy || !categoryId || name.trim().length < 1 || !Number.isFinite(priceMinor) || priceMinor < 0}
          label={editingId ? t("management.saveChangesButton") : t("management.addItemButton")}
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
        {editingId ? <ActionButton label={t("management.cancelEditingButton")} onPress={reset} secondary /> : null}
      </View>
      {props.items.length === 0 ? (
        <Empty text={props.businessType === "SUPERMARKET" ? t("management.noProductsYet") : t("management.noMenuItemsYet")} />
      ) : null}
      {props.items.map((item) => (
        <View key={item.id} style={styles.listCard}>
          <View style={styles.listCopy}>
            <Text style={styles.listTitle}>{item.name}</Text>
            <Text style={styles.listMeta}>
              {formatPrice(item.priceMinor)} · {item.unitLabel} · {item.isAvailable ? t("management.availableLabel") : t("management.unavailableLabel")}
              {item.stockQuantity === null ? "" : t("management.stockSuffix", { count: item.stockQuantity })}
              {item.isFeatured ? t("management.featuredSuffix") : ""}
            </Text>
          </View>
          <View style={styles.itemActions}>
            <SmallButton disabled={props.busy} label={t("management.editButton")} onPress={() => edit(item)} />
            <SmallButton
              disabled={props.busy}
              label={item.isAvailable ? t("management.pauseButton") : t("management.resumeButton")}
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
  const { t } = useTranslation(["common"]);
  return <View style={styles.statusPill}><Text style={styles.statusText}>{t(`status.${value}`, value.replaceAll("_", " "))}</Text></View>;
}

function Message({ tone, text }: { tone: "error" | "success"; text: string }) {
  return <Text style={[styles.message, tone === "error" ? styles.error : styles.success]}>{text}</Text>;
}

function Empty({ text }: { text: string }) {
  return <View style={styles.empty}><Text style={styles.emptyText}>{text}</Text></View>;
}

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error(i18n.t("common:sessionExpired"));
  return token;
}

function readError(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : i18n.t("common:requestFailed");
}

function formatPrice(minor: number): string {
  return `${(minor / 100).toFixed(2)} ILS`;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#F5FAFC", flex: 1 },
  header: { alignItems: "center", flexDirection: "row", paddingHorizontal: 18, paddingTop: 12 },
  backButton: { backgroundColor: "#FFFFFF", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  backText: { color: "#0F766E", fontWeight: "900" },
  headerCopy: { flex: 1, marginStart: 14 },
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
  listCopy: { flex: 1, paddingEnd: 10 },
  listTitle: { color: "#102A2A", fontSize: 15, fontWeight: "900" },
  listMeta: { color: "#64748B", fontSize: 11, marginTop: 5 },
  itemActions: { gap: 6 },
  smallButton: { backgroundColor: "#E7F4F1", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  smallButtonText: { color: "#0F766E", fontSize: 11, fontWeight: "900" },
  categoryPicker: { marginBottom: 14 },
  categoryChip: { backgroundColor: "#F1F5F9", borderRadius: 999, marginEnd: 8, paddingHorizontal: 13, paddingVertical: 9 },
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
