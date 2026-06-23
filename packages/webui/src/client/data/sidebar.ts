export interface NavItem {
	name: string;
	routerName: string;
	icon: string;
	label: string;
	/** Only shown to users in the admin group. */
	adminOnly?: boolean;
	/** User-store boolean field that must be true for this item to appear. */
	requiresPermission?: "canViewFavorites" | "canViewCharts";
}

export const mainNavItems: NavItem[] = [
	{
		name: "home",
		routerName: "Home",
		icon: "home",
		label: "sidebar.home",
	},
	{
		name: "search",
		routerName: "Search",
		icon: "search",
		label: "sidebar.search",
	},
	{
		name: "favorites",
		routerName: "Favorites",
		icon: "star",
		label: "sidebar.favorites",
		requiresPermission: "canViewFavorites",
	},
	{
		name: "charts",
		routerName: "Charts",
		icon: "show_chart",
		label: "sidebar.charts",
		requiresPermission: "canViewCharts",
	},
	{
		name: "library",
		routerName: "Library",
		icon: "library_music",
		label: "sidebar.library",
	},
	{
		name: "settings",
		routerName: "Settings",
		icon: "settings",
		label: "sidebar.settings",
	},
	{
		name: "admin",
		routerName: "Admin",
		icon: "admin_panel_settings",
		label: "sidebar.admin",
		adminOnly: true,
	},
	{
		name: "about",
		routerName: "About",
		icon: "info",
		label: "sidebar.about",
	},
];
