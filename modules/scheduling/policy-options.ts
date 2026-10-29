/** Option values per policy field; message keys `policy.<field>.<value>` are checked by tests/unit/messages.test.ts. */
export const POLICY_OPTIONS = {
  method: ["queue", "timed"],
  overbooking: ["disallow", "receptionist_override", "doctor_or_owner_approval"],
  queueOrdering: ["fcfs", "reservation_priority"],
  walkIn: ["auto_append", "receptionist_placement"],
  absentWhenCalled: ["move_to_end", "skip_and_prioritize", "receptionist_assignment"],
  patientCancellation: ["receptionist_only", "patient_self_service", "patient_request_approval"],
} as const;
