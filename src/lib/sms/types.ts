export interface SmsSendPayload {
  SmsBody: string;
  Mobiles: string[];
  SmsNumber: string;
}

export interface SmsStatus {
  SuccessCount: number;
  R_Success: boolean;
  R_Code: number;
  R_Message: string;
  R_Error: string | null;
  DataList: Array<{
    MessageId?: string;
    Mobile?: string;
    Cost?: number;
  }>;
}

export interface SendSmsResult {
  success: boolean;
  code: number;
  message: string;
  data?: {
    messageId?: string;
    cost?: number;
    successCount?: number;
  };
  raw?: unknown;
}
