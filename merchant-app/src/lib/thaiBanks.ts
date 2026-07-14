// Thai bank codes for Slip2Go's checkReceiver.accountType. Slip2Go uses the
// standard Thai (ITMX) 3-digit bank code prefixed with "01" — e.g. Bangkok
// Bank 002 -> "01002", Kasikorn 004 -> "01004" (both confirmed against a live
// Slip2Go response where receiver.bank.id was the 3-digit form). Ordered with
// the common retail banks first. If a shop's bank is missing, verify its code
// on the Slip2Go dashboard's "บัญชีธนาคาร" page before adding it here.
export type ThaiBank = { code: string; name: string };

export const THAI_BANKS: ThaiBank[] = [
  { code: "01002", name: "ธนาคารกรุงเทพ (BBL)" },
  { code: "01004", name: "ธนาคารกสิกรไทย (KBANK)" },
  { code: "01006", name: "ธนาคารกรุงไทย (KTB)" },
  { code: "01014", name: "ธนาคารไทยพาณิชย์ (SCB)" },
  { code: "01011", name: "ธนาคารทหารไทยธนชาต (ttb)" },
  { code: "01025", name: "ธนาคารกรุงศรีอยุธยา (BAY)" },
  { code: "01030", name: "ธนาคารออมสิน (GSB)" },
  { code: "01034", name: "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร (BAAC)" },
  { code: "01033", name: "ธนาคารอาคารสงเคราะห์ (GHB)" },
  { code: "01069", name: "ธนาคารเกียรตินาคินภัทร (KKP)" },
  { code: "01067", name: "ธนาคารทิสโก้ (TISCO)" },
  { code: "01022", name: "ธนาคารซีไอเอ็มบี ไทย (CIMBT)" },
  { code: "01024", name: "ธนาคารยูโอบี (UOB)" },
  { code: "01073", name: "ธนาคารแลนด์ แอนด์ เฮ้าส์ (LH Bank)" },
  { code: "01071", name: "ธนาคารไทยเครดิต (TCRB)" },
  { code: "01070", name: "ธนาคารไอซีบีซี (ไทย) (ICBC)" },
  { code: "01066", name: "ธนาคารอิสลามแห่งประเทศไทย (IBANK)" },
  { code: "01017", name: "ธนาคารซิตี้แบงก์ (Citi)" },
  { code: "01018", name: "ธนาคารสแตนดาร์ดชาร์เตอร์ด (SCBT)" },
  { code: "01031", name: "ธนาคารเอชเอสบีซี (HSBC)" },
  { code: "01098", name: "ธนาคารพัฒนาวิสาหกิจฯ (SME Bank)" },
  { code: "01099", name: "ธนาคารเพื่อการส่งออกและนำเข้าฯ (EXIM)" },
];
