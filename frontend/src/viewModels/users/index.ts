/**
 * User ViewModels Module
 *
 * Exports ViewModels for user management following the MVVM pattern:
 * - UsersViewModel for list, filtering, pagination, and CRUD operations
 * - UserFormViewModel for invitation form state management
 *
 * Usage:
 * ```typescript
 * import { UsersViewModel, UserFormViewModel } from '@/viewModels/users';
 *
 * // Create list/CRUD ViewModel with injected services
 * const usersVM = new UsersViewModel();
 * await usersVM.loadUsers();
 *
 * // Create form ViewModel with assignable roles
 * const formVM = new UserFormViewModel(assignableRoles);
 * formVM.setEmail('user@example.com');
 * await formVM.submit(commandService);
 * ```
 *
 * @see UsersViewModel for list and CRUD operations
 * @see UserFormViewModel for form state management
 */

export { UsersViewModel } from './UsersViewModel';
export { UserFormViewModel } from './UserFormViewModel';
