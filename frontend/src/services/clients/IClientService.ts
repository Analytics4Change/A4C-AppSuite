/**
 * Client Service Interface
 *
 * Contract for client lifecycle, sub-entity CRUD, and query operations.
 * Maps 1:1 to the 25 api.* RPC functions in client_api_functions migration.
 */

import type {
  Client,
  ClientListItem,
  ClientRpcResult,
  RegisterClientParams,
  UpdateClientParams,
  AdmitClientParams,
  DischargeClientParams,
  AddPhoneParams,
  UpdatePhoneParams,
  AddEmailParams,
  UpdateEmailParams,
  AddAddressParams,
  UpdateAddressParams,
  AddInsuranceParams,
  UpdateInsuranceParams,
  ChangePlacementParams,
  AddFundingSourceParams,
  UpdateFundingSourceParams,
} from '@/types/client.types';

export interface IClientService {
  // Queries
  listClients(status?: string, searchTerm?: string): Promise<ClientListItem[]>;
  getClient(clientId: string): Promise<Client>;

  // Lifecycle
  registerClient(params: RegisterClientParams): Promise<ClientRpcResult>;
  updateClient(clientId: string, params: UpdateClientParams): Promise<ClientRpcResult>;
  admitClient(clientId: string, params?: AdmitClientParams): Promise<ClientRpcResult>;
  dischargeClient(clientId: string, params: DischargeClientParams): Promise<ClientRpcResult>;

  // Phone
  addClientPhone(clientId: string, params: AddPhoneParams): Promise<ClientRpcResult>;
  updateClientPhone(
    clientId: string,
    phoneId: string,
    params: UpdatePhoneParams
  ): Promise<ClientRpcResult>;
  removeClientPhone(clientId: string, phoneId: string, reason?: string): Promise<ClientRpcResult>;

  // Email
  addClientEmail(clientId: string, params: AddEmailParams): Promise<ClientRpcResult>;
  updateClientEmail(
    clientId: string,
    emailId: string,
    params: UpdateEmailParams
  ): Promise<ClientRpcResult>;
  removeClientEmail(clientId: string, emailId: string, reason?: string): Promise<ClientRpcResult>;

  // Address
  addClientAddress(clientId: string, params: AddAddressParams): Promise<ClientRpcResult>;
  updateClientAddress(
    clientId: string,
    addressId: string,
    params: UpdateAddressParams
  ): Promise<ClientRpcResult>;
  removeClientAddress(
    clientId: string,
    addressId: string,
    reason?: string
  ): Promise<ClientRpcResult>;

  // Insurance
  addClientInsurance(clientId: string, params: AddInsuranceParams): Promise<ClientRpcResult>;
  updateClientInsurance(
    clientId: string,
    policyId: string,
    params: UpdateInsuranceParams
  ): Promise<ClientRpcResult>;
  removeClientInsurance(
    clientId: string,
    policyId: string,
    reason?: string
  ): Promise<ClientRpcResult>;

  // Placement
  changeClientPlacement(clientId: string, params: ChangePlacementParams): Promise<ClientRpcResult>;
  endClientPlacement(
    clientId: string,
    endDate?: string,
    reasonText?: string
  ): Promise<ClientRpcResult>;

  // Funding Source
  addClientFundingSource(
    clientId: string,
    params: AddFundingSourceParams
  ): Promise<ClientRpcResult>;
  updateClientFundingSource(
    clientId: string,
    sourceId: string,
    params: UpdateFundingSourceParams
  ): Promise<ClientRpcResult>;
  removeClientFundingSource(
    clientId: string,
    sourceId: string,
    reason?: string
  ): Promise<ClientRpcResult>;

  // Contact Assignment
  assignClientContact(
    clientId: string,
    contactId: string,
    designation: string,
    reason?: string
  ): Promise<ClientRpcResult>;
  unassignClientContact(
    clientId: string,
    contactId: string,
    designation: string,
    reason?: string
  ): Promise<ClientRpcResult>;
}
