/**
 * Organization Units Pages
 *
 * Page components for organizational unit management.
 *
 * Note: All functionality consolidated into OrganizationUnitsManagePage with
 * permission-based UI rendering. The page adapts its layout and available
 * actions based on user permissions (view_ou, create_ou, update_ou, etc.)
 */

export { OrganizationUnitsManagePage } from './OrganizationUnitsManagePage';
// OrganizationUnitsListPage removed - consolidated into ManagePage with permission-based UI
// OrganizationUnitCreatePage and OrganizationUnitEditPage removed - functionality consolidated into ManagePage
