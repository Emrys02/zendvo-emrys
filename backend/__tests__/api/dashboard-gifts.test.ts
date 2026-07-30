import { GET } from "../../src/api/dashboard/gifts/route";
import { getAuthPayload } from "../../src/lib/auth-session";
import { NextRequest } from "next/server";

jest.mock("../../src/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

jest.mock("../../src/lib/db", () => {
  const mockSentGifts: any[] = [];
  const mockReceivedGifts: any[] = [];

  const createSelectChain = (giftsList: any[]) => ({
    from: jest.fn().mockReturnValue({
      leftJoin: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockResolvedValue(giftsList),
        }),
      }),
      where: jest.fn().mockReturnValue({
        orderBy: jest.fn().mockResolvedValue(giftsList),
      }),
    }),
  });

  return {
    db: {
      select: jest.fn()
        .mockImplementationOnce(() => createSelectChain(mockSentGifts))
        .mockImplementationOnce(() => createSelectChain(mockReceivedGifts)),
    },
    __mockSentGifts: mockSentGifts,
    __mockReceivedGifts: mockReceivedGifts,
  };
});

describe("GET /api/dashboard/gifts", () => {
  const mockGetAuthPayload = getAuthPayload as jest.Mock;
  const { __mockSentGifts, __mockReceivedGifts } = require("../../src/lib/db");

  beforeEach(() => {
    jest.clearAllMocks();
    __mockSentGifts.length = 0;
    __mockReceivedGifts.length = 0;
  });

  it("should return 401 Unauthorized if not authenticated", async () => {
    mockGetAuthPayload.mockResolvedValue(null);
    const req = new NextRequest("http://localhost:3000/api/dashboard/gifts");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("should return aggregated stats and enforce privacy rules on received gifts", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-123" });

    // Populate mock received gifts (one anonymous/hidden sender, one normal)
    __mockReceivedGifts.push(
      {
        id: "gift-anon",
        recipientId: "user-123",
        senderId: "secret-sender",
        senderName: "Secret Sender",
        senderEmail: "secret@example.com",
        senderAvatar: "http://avatar.com/secret.png",
        amount: 100,
        currency: "USDC",
        status: "confirmed",
        hideSender: true,
        isAnonymous: false,
        hideAmount: false,
        unlockDatetime: new Date(Date.now() - 10000),
      },
      {
        id: "gift-public",
        recipientId: "user-123",
        senderId: "public-sender",
        senderName: "Jane Doe",
        senderEmail: "jane@example.com",
        senderAvatar: "http://avatar.com/jane.png",
        amount: 250,
        currency: "USDC",
        status: "completed",
        hideSender: false,
        isAnonymous: false,
        hideAmount: false,
        unlockDatetime: new Date(Date.now() - 10000),
      }
    );

    const req = new NextRequest("http://localhost:3000/api/dashboard/gifts");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.stats).toBeDefined();

    // Verify privacy masking on anonymous gift
    const anonGift = body.receivedGifts.find((g: any) => g.id === "gift-anon");
    expect(anonGift.senderId).toBeNull();
    expect(anonGift.senderName).toBe("Anonymous");
    expect(anonGift.senderEmail).toBeNull();
    expect(anonGift.senderAvatar).toBeNull();

    // Verify public gift details remain untouched
    const publicGift = body.receivedGifts.find((g: any) => g.id === "gift-public");
    expect(publicGift.senderName).toBe("Jane Doe");
    expect(publicGift.senderEmail).toBe("jane@example.com");
  });
});
