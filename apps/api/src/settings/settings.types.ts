/** The full platform settings view returned to administrators. */
export type PlatformSettingsView = {
  substitutionOptionEnabled: boolean;
  updatedAt: Date;
};

/**
 * The subset any authenticated app user may read. Deliberately narrow: the
 * customer app only needs to know whether to show the "no substitution" choice.
 */
export type PublicPlatformSettingsView = {
  substitutionOptionEnabled: boolean;
};
