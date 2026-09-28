/** The full platform settings view returned to administrators. */
export type PlatformSettingsView = {
  substitutionOptionEnabled: boolean;
  updatedAt: Date;
};

/**
 * The subset any authenticated app user may read. Deliberately narrow: the
 * customer app only needs to know whether to show the "no substitution" choice
 * and whether restaurants are open to customers yet.
 */
export type PublicPlatformSettingsView = {
  substitutionOptionEnabled: boolean;
  /** The launch gate for the restaurant vertical (`RESTAURANT_ORDERING_ENABLED`); false hides it from customers. */
  restaurantOrderingEnabled: boolean;
};
