"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StripeCheckoutError = void 0;
exports.createCheckoutSession = createCheckoutSession;
const stripe_1 = __importDefault(require("stripe"));
class StripeCheckoutError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = "StripeCheckoutError";
    }
}
exports.StripeCheckoutError = StripeCheckoutError;
function getStripeClient() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
        throw new Error("STRIPE_SECRET_KEY environment variable is not set");
    }
    return new stripe_1.default(key);
}
async function createCheckoutSession(input) {
    const stripe = getStripeClient();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    let session;
    try {
        session = await stripe.checkout.sessions.create({
            mode: "payment",
            payment_method_types: ["card"],
            line_items: [
                {
                    price_data: {
                        currency: input.currency.toLowerCase(),
                        unit_amount: input.amount,
                        product_data: { name: "Gift Payment" },
                    },
                    quantity: 1,
                },
            ],
            client_reference_id: input.paymentReference,
            metadata: {
                gift_id: input.giftId,
                payment_reference: input.paymentReference,
            },
            ...(input.senderEmail ? { customer_email: input.senderEmail } : {}),
            success_url: `${appUrl}/gifts/success?ref=${input.paymentReference}`,
            cancel_url: `${appUrl}/gifts/cancel?ref=${input.paymentReference}`,
        });
    }
    catch (err) {
        if (err instanceof stripe_1.default.errors.StripeError) {
            throw new StripeCheckoutError(`Stripe API error: ${err.message}`, err);
        }
        throw new StripeCheckoutError("Unexpected error creating checkout session", err);
    }
    if (!session.url) {
        throw new StripeCheckoutError("Stripe returned a session without a checkout URL");
    }
    return {
        sessionId: session.id,
        checkoutUrl: session.url,
    };
}
