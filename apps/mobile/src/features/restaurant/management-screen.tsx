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
import { readError } from "../../core/errors";
import { getAccessToken } from "../../core/session";
import { getCurrentCoordinates } from "../../core/location";
import i18n from "../../i18n";
import { Icon } from "../../theme/icon";
import { colors, radius, spacing, statusFamily, statusPalette as tokenStatusPalette } from "../../theme/tokens";
import { text } from "../../theme/typography";
import { InventoryWorkspace } from "./inventory-screen";

type Section = "profile" | "categories" | "items" | "inventory";

const tabLabelKeys: Record<Section, string> = {
  profile: "management.tabProfile",
  categories: "management.tabCategories",
  items: "management.tabItems",
  inventory: "management.tabInventory"
};

export function RestaurantManagementScreen({ onBack, onOpenSettings, initialEditItemId }: { onBack: () => void; onOpenSettings: () => void; initialEditItemId?: string }) {
  const { t } = useTranslation(["restaurantOps", "common"]);
  const [profile, setProfile] = useState<RestaurantOwnerProfile | null>(null);
  const [categories, setCategories] = useState<MenuCategoryOwner[]>([]);
  const [items, setItems] = useState<MenuItemOwner[]>([]);
  const [section, setSection] = useState<Section>(initialEditItemId ? "items" : "profile");
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

  async function run(action: (token: string) => Promise<void>, successMessage: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action(await requireToken());
      setNotice(successMessage);
      return true;
    } catch (requestError) {
      setError(readError(requestError));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar backgroundColor={colors.surfaceSunk} barStyle="dark-content" />
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
        <Pressable accessibilityLabel={t("common:settings")} onPress={onOpenSettings} style={styles.backButton}>
          <Icon name="settings" size="sm" />
        </Pressable>
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
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
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
              initialEditItemId={initialEditItemId}
              onSave={(draft, editingId) =>
                run(async (token) => {
                  const saved = editingId
                    ? await updateRestaurantMenuItem(token, editingId, draft)
                    : await createRestaurantMenuItem(token, { ...draft, costPriceMinor: draft.costPriceMinor ?? undefined });
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
  onSave: (input: { name: string; description: string; addressLine: string; logoUrl: string; latitude?: number; longitude?: number; opensAt: string; closesAt: string }) => void;
  onToggleOpen: () => void;
}) {
  const { t } = useTranslation(["restaurantOps"]);
  const [name, setName] = useState(props.profile.name);
  const [description, setDescription] = useState(props.profile.description ?? "");
  const [addressLine, setAddressLine] = useState(props.profile.addressLine);
  const [logoUrl, setLogoUrl] = useState(props.profile.logoUrl ?? "");
  const [opensAt, setOpensAt] = useState(props.profile.opensAt ?? "");
  const [closesAt, setClosesAt] = useState(props.profile.closesAt ?? "");
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
      <Text style={styles.label}>{t("management.workingHoursTitle")}</Text>
      <View style={styles.hoursRow}>
        <View style={styles.hoursField}>
          <Field label={t("management.opensAtLabel")} value={opensAt} onChangeText={setOpensAt} keyboardType="number-pad" />
        </View>
        <View style={styles.hoursField}>
          <Field label={t("management.closesAtLabel")} value={closesAt} onChangeText={setClosesAt} keyboardType="number-pad" />
        </View>
      </View>
      <Text style={styles.hint}>{t("management.workingHoursHint")}</Text>
      {opensAt.trim() && closesAt.trim() && props.profile.isOpen ? (
        <Text style={[styles.hint, props.profile.isOpenNow ? styles.openNow : styles.closedNow]}>
          {props.profile.isOpenNow ? t("management.openNowLabel") : t("management.closedByHoursLabel")}
        </Text>
      ) : null}
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
          longitude: longitude ?? undefined,
          opensAt: opensAt.trim(),
          closesAt: closesAt.trim()
        })}
      />
      <ActionButton
        disabled={props.busy || props.profile.status !== "APPROVED" || latitude === null || longitude === null}
        label={props.profile.isOpen ? t("management.closeStoreButton") : t("management.openStoreButton")}
        onPress={props.onToggleOpen}
        secondary
      />
    </View>
  );
}

function CategoriesSection(props: {
  categories: MenuCategoryOwner[];
  busy: boolean;
  onCreate: (name: string, sortOrder: number | undefined) => Promise<boolean>;
  onToggle: (category: MenuCategoryOwner) => void;
}) {
  const { t } = useTranslation(["restaurantOps"]);
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const nextSortOrder = props.categories.reduce((max, category) => Math.max(max, category.sortOrder), -1) + 1;
  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("management.newCategoryTitle")}</Text>
        <Field label={t("management.categoryNameLabel")} value={name} onChangeText={setName} />
        <Field label={t("management.sortOrderLabel")} value={sortOrder} onChangeText={setSortOrder} keyboardType="number-pad" />
        <Text style={styles.hint}>{t("management.sortOrderAutoHint", { next: nextSortOrder })}</Text>
        {localError ? <Message tone="error" text={localError} /> : null}
        <ActionButton
          disabled={props.busy}
          label={t("management.addCategoryButton")}
          onPress={() => {
            if (name.trim().length < 1) {
              setLocalError(t("management.errorNameRequired"));
              return;
            }
            setLocalError(null);
            const trimmedOrder = sortOrder.trim();
            const parsedOrder = trimmedOrder === "" ? undefined : Math.max(0, Number.parseInt(trimmedOrder, 10) || 0);
            void (async () => {
              const success = await props.onCreate(name.trim(), parsedOrder);
              if (success) {
                setName("");
                setSortOrder("");
              }
            })();
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
  costPriceMinor?: number | null;
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
  initialEditItemId?: string;
  onSave: (draft: ItemDraft, editingId: string | null) => Promise<boolean>;
  onToggle: (item: MenuItemOwner) => void;
}) {
  const { t } = useTranslation(["restaurantOps"]);
  const activeCategories = useMemo(() => props.categories.filter((category) => category.isActive), [props.categories]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [handledInitialEdit, setHandledInitialEdit] = useState(false);
  const [categoryId, setCategoryId] = useState(activeCategories[0]?.id ?? props.categories[0]?.id ?? "");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [sku, setSku] = useState("");
  const [brand, setBrand] = useState("");
  const [unitLabel, setUnitLabel] = useState("item");
  const [stockQuantity, setStockQuantity] = useState("");
  const [isFeatured, setIsFeatured] = useState(false);
  const [isVariableWeight, setIsVariableWeight] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [reorderLevel, setReorderLevel] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const priceMinor = Math.round(Number(price.replace(",", ".")) * 100);
  const costPriceMinor = costPrice.trim() ? Math.round(Number(costPrice.replace(",", ".")) * 100) : undefined;

  function reset() {
    setEditingId(null);
    setName("");
    setPrice("");
    setCostPrice("");
    setDescription("");
    setImageUrl("");
    setSku("");
    setBrand("");
    setUnitLabel("item");
    setStockQuantity("");
    setIsFeatured(false);
    setIsVariableWeight(false);
    setBarcode("");
    setReorderLevel("");
    setLocalError(null);
  }

  function edit(item: MenuItemOwner) {
    setEditingId(item.id);
    setCategoryId(item.categoryId);
    setName(item.name);
    setPrice((item.priceMinor / 100).toFixed(2));
    setCostPrice(item.costPriceMinor === null ? "" : (item.costPriceMinor / 100).toFixed(2));
    setDescription(item.description ?? "");
    setImageUrl(item.imageUrl ?? "");
    setSku(item.sku ?? "");
    setBrand(item.brand ?? "");
    setUnitLabel(item.unitLabel);
    setStockQuantity(item.stockQuantity === null ? "" : String(item.stockQuantity));
    setIsFeatured(item.isFeatured);
    setIsVariableWeight(item.isVariableWeight);
    setBarcode(item.barcode ?? "");
    setReorderLevel(item.reorderLevel === null ? "" : String(item.reorderLevel));
    setLocalError(null);
  }

  // When arriving from the home dashboard's "edit" action, open that item's form
  // as soon as it is available — but only once, so the owner can still cancel out.
  useEffect(() => {
    if (handledInitialEdit || !props.initialEditItemId) return;
    const target = props.items.find((item) => item.id === props.initialEditItemId);
    if (target) {
      edit(target);
      setHandledInitialEdit(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialEditItemId, props.items, handledInitialEdit]);

  function validate(): string | null {
    if (!categoryId) return t("management.errorCategoryRequired");
    if (name.trim().length < 1) return t("management.errorNameRequired");
    if (!price.trim() || !Number.isFinite(priceMinor) || priceMinor < 0) return t("management.errorPriceInvalid");
    if (costPrice.trim() && (!Number.isFinite(costPriceMinor) || (costPriceMinor ?? 0) < 0)) {
      return t("management.errorCostPriceInvalid");
    }
    return null;
  }

  if (props.categories.length === 0) return <Empty text={t("management.createCategoryFirstEmpty")} />;

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {editingId ? t("management.editItemPrefix") : t("management.newItemPrefix")}{" "}
          {props.businessType === "SUPERMARKET" ? t("management.productWord") : t("management.menuItemWord")}
        </Text>
        <Field label={props.businessType === "SUPERMARKET" ? t("management.productNameLabel") : t("management.itemNameLabel")} value={name} onChangeText={setName} />
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
        <Field label={t("management.priceLabel")} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
        <Field label={t("management.costPriceLabel")} value={costPrice} onChangeText={setCostPrice} keyboardType="decimal-pad" />
        <Field label={t("management.descriptionLabel")} value={description} onChangeText={setDescription} multiline />
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
        {localError ? <Message tone="error" text={localError} /> : null}
        <ActionButton
          disabled={props.busy}
          label={editingId ? t("management.saveChangesButton") : t("management.addItemButton")}
          onPress={() => {
            const validationError = validate();
            if (validationError) {
              setLocalError(validationError);
              return;
            }
            setLocalError(null);
            void (async () => {
              const success = await props.onSave({
                categoryId,
                name: name.trim(),
                priceMinor,
                costPriceMinor: costPrice.trim() ? costPriceMinor : editingId ? null : undefined,
                description: description.trim() || undefined,
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
              if (success) reset();
            })();
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
              {item.costPriceMinor === null ? "" : t("management.costSuffix", { amount: formatPrice(item.costPriceMinor) })}
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
  const palette = tokenStatusPalette[statusFamily(value)];
  return (
    <View style={[styles.statusPill, { backgroundColor: palette.background }]}>
      <Text style={[styles.statusText, { color: palette.foreground }]}>{t(`status.${value}`, value.replaceAll("_", " "))}</Text>
    </View>
  );
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


function formatPrice(minor: number): string {
  return `${(minor / 100).toFixed(2)} ILS`;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.surfaceSunk, flex: 1 },
  header: { alignItems: "center", flexDirection: "row", paddingHorizontal: spacing[4], paddingTop: spacing[3] },
  backButton: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  backText: { ...text("bodySm", "bold"), color: colors.primary },
  headerCopy: { flex: 1, marginStart: spacing[4] },
  title: { ...text("h1", "bold"), color: colors.text },
  subtitle: { ...text("caption"), color: colors.textMuted, marginTop: spacing[1] },
  tabs: { flexDirection: "row", gap: spacing[2], padding: spacing[4], paddingBottom: spacing[2] },
  tab: { alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, flex: 1, padding: spacing[3] },
  tabActive: { backgroundColor: colors.primary },
  tabText: { ...text("caption", "bold"), color: colors.textMuted },
  tabTextActive: { color: colors.textInverse },
  center: { alignItems: "center", flex: 1, justifyContent: "center" },
  content: { alignSelf: "center", maxWidth: 760, padding: spacing[4], paddingBottom: spacing[9], width: "100%" },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, marginBottom: spacing[4], padding: spacing[4] },
  cardTitle: { ...text("h3", "bold"), color: colors.text, marginBottom: spacing[4] },
  statusRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: spacing[3] },
  statusPill: { borderRadius: radius.pill, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  statusText: { ...text("label", "bold") },
  openState: { ...text("caption", "bold"), color: colors.error },
  openStateActive: { color: colors.success },
  pendingNote: { ...text("bodySm"), backgroundColor: colors.infoSubtle, borderRadius: radius.md, color: colors.info, marginBottom: spacing[4], padding: spacing[3] },
  locationNote: { backgroundColor: colors.primarySubtle, borderRadius: radius.md, color: colors.primaryPressed, ...text("caption"), padding: spacing[3] },
  locationError: { ...text("caption"), color: colors.error, marginTop: spacing[2] },
  field: { marginBottom: spacing[4] },
  label: { ...text("caption", "bold"), color: colors.text, marginBottom: spacing[2] },
  hint: { ...text("caption"), color: colors.textMuted, marginBottom: spacing[3], marginTop: -spacing[2] },
  hoursRow: { flexDirection: "row", gap: spacing[3] },
  hoursField: { flex: 1 },
  openNow: { ...text("caption", "bold"), color: colors.success },
  closedNow: { ...text("caption", "bold"), color: colors.error },
  input: { backgroundColor: colors.surfaceSunk, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.text, minHeight: 48, paddingHorizontal: spacing[3] },
  multilineInput: { minHeight: 78, paddingTop: spacing[3], textAlignVertical: "top" },
  actionButton: { alignItems: "center", backgroundColor: colors.primary, borderRadius: radius.md, justifyContent: "center", marginTop: spacing[1], minHeight: 48, paddingHorizontal: spacing[4] },
  actionButtonSecondary: { backgroundColor: colors.primarySubtle, marginTop: spacing[2] },
  actionText: { ...text("bodySm", "bold"), color: colors.textInverse },
  actionTextSecondary: { color: colors.primaryPressed },
  disabled: { opacity: 0.45 },
  listCard: { alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.lg, flexDirection: "row", marginBottom: spacing[2], padding: spacing[4] },
  listCopy: { flex: 1, paddingEnd: spacing[2] },
  listTitle: { ...text("bodySm", "bold"), color: colors.text },
  listMeta: { ...text("label"), color: colors.textMuted, marginTop: spacing[1] },
  itemActions: { gap: spacing[1] },
  smallButton: { backgroundColor: colors.primarySubtle, borderRadius: radius.sm, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  smallButtonText: { ...text("label", "bold"), color: colors.primaryPressed },
  categoryPicker: { marginBottom: spacing[4] },
  categoryChip: { backgroundColor: colors.surfaceSunk, borderRadius: radius.pill, marginEnd: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  categoryChipActive: { backgroundColor: colors.primary },
  categoryChipText: { ...text("label", "bold"), color: colors.textMuted },
  categoryChipTextActive: { color: colors.textInverse },
  featuredToggle: { alignItems: "center", backgroundColor: colors.surfaceSunk, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing[4], padding: spacing[3] },
  featuredToggleActive: { backgroundColor: colors.successSubtle, borderColor: colors.success },
  featuredToggleText: { ...text("caption", "bold"), color: colors.textMuted },
  featuredToggleTextActive: { color: colors.success },
  message: { borderRadius: radius.md, marginBottom: spacing[3], padding: spacing[3] },
  error: { backgroundColor: colors.errorSubtle, color: colors.error },
  success: { backgroundColor: colors.successSubtle, color: colors.success },
  empty: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing[6] },
  emptyText: { ...text("bodySm"), color: colors.textMuted, textAlign: "center" }
});
