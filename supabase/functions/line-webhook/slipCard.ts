// The receipt a customer gets after their slip is verified.
//
// Text is hardcoded Thai like the rest of this function's replies: the merchant
// apps' t() lives in the browser, and a webhook has no idea what language the
// customer reads — LINE gives us no locale on a message event.

type CardInput = {
  amount: number;
  pointsAwarded: number;
  balance: number;
  // Minimum balance the shop requires before redeeming anything. Null when the
  // admin hasn't set one, in which case the card says nothing about redeeming.
  redeemThreshold: number | null;
  // Null when the shop hasn't configured a LIFF app; the card then has no button
  // rather than a button pointing at liff.line.me/null.
  liffId: string | null;
};

const BLUE = "#007AFF";
const INK = "#0F172A";
const MUTED = "#64748B";
const LINE_GREY = "#E2E8F0";

function row(label: string, value: string, strong = false) {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: label, size: "sm", color: MUTED, flex: 0 },
      {
        type: "text",
        text: value,
        size: strong ? "lg" : "sm",
        weight: strong ? "bold" : "regular",
        color: strong ? BLUE : INK,
        align: "end",
      },
    ],
  };
}

// The alt text is a real fallback, not a label: it's what the customer sees in
// their chat list and on any client that can't render Flex.
export function slipCardAltText(input: CardInput): string {
  return `ได้รับ ${input.pointsAwarded} แต้ม • ยอดสะสม ${input.balance} แต้ม`;
}

export function buildSlipCard(input: CardInput) {
  const { amount, pointsAwarded, balance, redeemThreshold, liffId } = input;

  const body: unknown[] = [
    { type: "text", text: "ได้รับแต้มแล้ว", weight: "bold", size: "xl", color: INK },
    { type: "text", text: "ตรวจสอบสลิปเรียบร้อย", size: "sm", color: MUTED },
    { type: "separator", margin: "lg", color: LINE_GREY },
    {
      type: "box",
      layout: "vertical",
      margin: "lg",
      spacing: "md",
      contents: [
        row("ยอดโอน", `${amount.toLocaleString("th-TH")} บาท`),
        row("แต้มที่ได้รับ", `+${pointsAwarded}`),
        { type: "separator", margin: "md", color: LINE_GREY },
        row("แต้มสะสมทั้งหมด", `${balance} แต้ม`, true),
      ],
    },
  ];

  if (redeemThreshold !== null && redeemThreshold > 0) {
    const short = redeemThreshold - balance;
    // Deliberately framed as progress toward the shop's threshold, not as a
    // promise that any particular reward is affordable — rewards carry their own
    // points_cost, which can be higher than the threshold.
    body.push({
      type: "box",
      layout: "vertical",
      margin: "lg",
      backgroundColor: short <= 0 ? "#E0F0FF" : "#F1F5F9",
      cornerRadius: "md",
      paddingAll: "md",
      contents: [
        {
          type: "text",
          text: short <= 0 ? "แลกของรางวัลได้แล้ว" : `อีก ${short} แต้ม แลกของรางวัลได้`,
          size: "sm",
          weight: "bold",
          color: short <= 0 ? BLUE : MUTED,
          align: "center",
          wrap: true,
        },
      ],
    });
  }

  const bubble: Record<string, unknown> = {
    type: "bubble",
    body: { type: "box", layout: "vertical", contents: body },
  };

  if (liffId) {
    bubble.footer = {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          color: BLUE,
          height: "sm",
          action: {
            type: "uri",
            label: "ดูแต้มและแลกของรางวัล",
            // The LIFF endpoint URL configured in the LINE console already
            // carries shop_id and liff_id, so a bare liff.line.me link is enough
            // to land them on their own card.
            uri: `https://liff.line.me/${liffId}`,
          },
        },
      ],
    };
  }

  return bubble;
}
