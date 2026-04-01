export type DeleteAccountResponse = {
  cancelled_event_ids: string[];
  removed_from_event_ids: string[];
  deleted_availability_count: number;
  deleted_device_token_count: number;
};
