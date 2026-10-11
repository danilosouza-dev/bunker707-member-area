// Componentes base do Admin Bunker707 (docs/17 §2.3 e §2.7).

export { AccountMenu, type AdminAccount } from "./account-menu";
export { AdminShellV2 } from "./admin-shell";
export { AdminTopbar } from "./admin-topbar";
export { AttentionCard, type AttentionTone } from "./attention-card";
export { AdminBreadcrumb, type AdminBreadcrumbItem } from "./breadcrumb";
export { ChartCard, ChartCardSkeleton, DEFAULT_CHART_HEIGHT } from "./chart-card";
export { DataTable, type DataTableColumn } from "./data-table";
export { EmptyState } from "./empty-state";
export { ErrorBanner } from "./error-banner";
export * from "./filters";
export {
  AdminField,
  PillGroup,
  adminInputClass,
  adminPillClasses,
  adminTextareaClass,
  fieldDescribedBy,
  type PillOption
} from "./form";
export {
  formatAdminRole,
  formatDelta,
  formatDeltaMagnitude,
  formatKpiValue,
  formatLongDate,
  getGreeting,
  getInitials
} from "./format";
export { GlobalFilters } from "./global-filters";
export { GlobalSearch } from "./global-search";
export { KpiTile } from "./kpi-tile";
export { AdminLinkButton } from "./link-button";
export {
  adminNavItems,
  buildAdminNavHref,
  formatAdminNavCount,
  getActiveAdminNavChild,
  getAdminLegacyAvailability,
  getAdminMobileTitle,
  getAdminTopbarScope,
  isAdminLegacyPath,
  isAdminV2Href,
  type AdminNavChild,
  type AdminNavCounts,
  type AdminNavId,
  type AdminNavItem,
  type AdminTopbarScope
} from "./nav";
export { AdminPage } from "./page-container";
export { PageHeader } from "./page-header";
export { PendingMigrationNotice } from "./pending-migration-notice";
export { PeriodMenu } from "./period-menu";
export { PhasePlaceholderPage } from "./phase-placeholder";
export { ProductFilter } from "./product-filter";
export { ProductThumb } from "./product-thumb";
export { ReleasePhraseField } from "./release-phrase-field";
export { SaveBar } from "./save-bar";
export { SectionTabs, type SectionTabItem } from "./section-tabs";
export { AdminSheet, AdminSheetSection } from "./sheet";
export { AdminShellSkeleton, EmptyStateSkeleton, KpiTileSkeleton, PageHeaderSkeleton, PlaceholderPageSkeleton } from "./skeletons";
export { Sparkline } from "./sparkline";
export { StatusChip, situationTone, type StatusChipTone } from "./status-chip";
export {
  adminMenuItem,
  adminMenuLabel,
  adminMenuMeta,
  adminMenuPopup,
  adminMenuSeparator,
  adminTopbarControl
} from "./styles";
export { ADMIN_TOAST_DURATION_MS, ADMIN_UNDO_DURATION_MS, AdminToaster, adminToast } from "./toast";
export { AdminTopbarTitle, useAdminTopbarTitle } from "./topbar-title";
