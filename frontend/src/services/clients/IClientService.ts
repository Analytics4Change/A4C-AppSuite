/**
 * Client Service Interface
 *
 * Contract for client lifecycle, sub-entity CRUD, and query operations.
 * Maps 1:1 to the 25 api.* RPC functions in client_api_functions migration.
 */

import type {
  Client,
  ClientListItem,
  ClientUpdateResult,
  ClientPhoneResult,
  ClientEmailResult,
  ClientAddressResult,
  ClientInsuranceResult,
  ClientFundingResult,
  ClientPlacementResult,
  ClientAssignmentResult,
  ClientVoidResult,
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
  registerClient(params: RegisterClientParams): Promise<ClientUpdateResult>;
  updateClient(clientId: string, params: UpdateClientParams): Promise<ClientUpdateResult>;
  admitClient(clientId: string, params?: AdmitClientParams): Promise<ClientUpdateResult>;
  dischargeClient(clientId: string, params: DischargeClientParams): Promise<ClientUpdateResult>;

  // Phone
  addClientPhone(clientId: string, params: AddPhoneParams): Promise<ClientPhoneResult>;
  updateClientPhone(
    clientId: string,
    phoneId: string,
    params: UpdatePhoneParams
  ): Promise<ClientPhoneResult>;
  removeClientPhone(clientId: string, phoneId: string, reason?: string): Promise<ClientVoidResult>;

  // Email
  addClientEmail(clientId: string, params: AddEmailParams): Promise<ClientEmailResult>;
  updateClientEmail(
    clientId: string,
    emailId: string,
    params: UpdateEmailParams
  ): Promise<ClientEmailResult>;
  removeClientEmail(clientId: string, emailId: string, reason?: string): Promise<ClientVoidResult>;

  // Address
  addClientAddress(clientId: string, params: AddAddressParams): Promise<ClientAddressResult>;
  updateClientAddress(
    clientId: string,
    addressId: string,
    params: UpdateAddressParams
  ): Promise<ClientAddressResult>;
  removeClientAddress(
    clientId: string,
    addressId: string,
    reason?: string
  ): Promise<ClientVoidResult>;

  // Insurance
  addClientInsurance(clientId: string, params: AddInsuranceParams): Promise<ClientInsuranceResult>;
  updateClientInsurance(
    clientId: string,
    policyId: string,
    params: UpdateInsuranceParams
  ): Promise<ClientInsuranceResult>;
  removeClientInsurance(
    clientId: string,
    policyId: string,
    reason?: string
  ): Promise<ClientVoidResult>;

  // Placement
  changeClientPlacement(
    clientId: string,
    params: ChangePlacementParams
  ): Promise<ClientPlacementResult>;
  endClientPlacement(
    clientId: string,
    endDate?: string,
    reasonText?: string
  ): Promise<ClientPlacementResult>;

  // Funding Source
  addClientFundingSource(
    clientId: string,
    params: AddFundingSourceParams
  ): Promise<ClientFundingResult>;
  updateClientFundingSource(
    clientId: string,
    sourceId: string,
    params: UpdateFundingSourceParams
  ): Promise<ClientFundingResult>;
  removeClientFundingSource(
    clientId: string,
    sourceId: string,
    reason?: string
  ): Promise<ClientVoidResult>;

  // Contact Assignment
  assignClientContact(
    clientId: string,
    contactId: string,
    designation: string,
    reason?: string
  ): Promise<ClientAssignmentResult>;
  unassignClientContact(
    clientId: string,
    contactId: string,
    designation: string,
    reason?: string
  ): Promise<ClientAssignmentResult>;
}
