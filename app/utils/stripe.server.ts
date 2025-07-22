import {
  getUserOrRedirect,
  getUserOrTriggerLogin,
} from "server/getUserUtils.server";
import { type User } from "@prisma/client";
import { data as json } from "react-router";
import Stripe from "stripe";
import { db } from "~/utils/db.server";

const isDevelopment = process.env.NODE_ENV === "development";

const ANUAL_PRICE = isDevelopment
  ? "price_1OinGRDtYmGT70YtS3fKsenE"
  : "price_1OgF7RDtYmGT70YtcGL3AxDQ"; // prod

const MONTHLY_PLAN = isDevelopment
  ? "price_1OinFxDtYmGT70YtW9UbUdpM"
  : "price_1OgF7RDtYmGT70YtJB3kRl9T"; // prod

const DOMAIN =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : "https://formmy.app";

export const searchStripeSubscriptions = async (user: User) => {
  const stripe = new Stripe(
    (isDevelopment
      ? process.env.TEST_STRIPE_PV
      : process.env.STRIPE_PRIVATE_KEY) ?? ""
  );
  if (!user.subscriptionIds[0]) return null;
  try {
    const subscription = await stripe.subscriptions.retrieve(
      user.subscriptionIds[0]
    );
    return subscription;
  } catch (e) {
    console.error(e);
    return null;
  }
};

// @TODO: check for duplications
export const getOrCreateCustomerId = async (user: User): Promise<string> => {
  const isDevelopment = process.env.NODE_ENV === "development";
  const stripe = new Stripe(
    (isDevelopment
      ? process.env.TEST_STRIPE_PV
      : process.env.STRIPE_PRIVATE_KEY) ?? ""
  );
  if (user.customerId) {
    const exists = await stripe.customers.retrieve(user.customerId); // @TODO: this could fail
    if (exists.id) return exists.id;
    // if (exists.deleted) throw new Error("No such customer");
  }
  const customer = await stripe.customers.create({
    name: user.name ?? "",
    email: user.email,
  });
  if (!customer) throw new Error("No se pudo crear el customer");
  await db.user.update({
    where: { id: user.id },
    data: { customerId: customer.id },
  });
  return customer.id;
};

export const createBillingSessionURL = async (user: User) => {
  const isDevelopment = process.env.NODE_ENV === "development";
  const stripe = new Stripe(
    (isDevelopment
      ? process.env.TEST_STRIPE_PV
      : process.env.STRIPE_PRIVATE_KEY) ?? ""
  );
  const customer = await getOrCreateCustomerId(user);
  const session = await stripe.billingPortal.sessions.create({
    customer,
  });
  return session.url;
};

export const createBillingSessionOrCheckoutURL = async (
  user: User,
  origin: string
): Promise<string | undefined> => {
  try {
    if (user.customerId && user.plan === "PRO") {
      return createBillingSessionURL(user);
    } else {
      return createCheckoutSessionURL({ user, origin });
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      console.error(e);
    }
  }
};

export const getStripeEvent = async (
  request: Request
): Promise<StripeEvent | undefined> => {
  const stripe = new Stripe(
    process.env.NODE_ENV === "development"
      ? process.env.TEST_STRIPE_PV ?? ""
      : process.env.STRIPE_PRIVATE_KEY ?? ""
  );
  const payload = await request.text();
  const webhookSecret =
    (process.env.NODE_ENV === "development"
      ? process.env.TEST_STRIPE_SS
      : process.env.STRIPE_SIGNING_SECRET) ?? "";
  const webhookStripeSignatureHeader =
    request.headers.get("stripe-signature") || "";
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      payload,
      webhookStripeSignatureHeader,
      webhookSecret
    );
  } catch (error) {
    console.error(`Stripe construct event error: ${error}`);
    throw json(error, { status: 400 });
  }
  return event;
};

export const createCheckoutSessionURL = async ({
  user,
  origin,
  coupon,
  price, // anual by default
}: {
  origin: string;
  coupon?: string;
  user: User;
  price?: string;
}) => {
  if (!user) throw new Error("Need a user to create a customer");

  const isDevelopment = process.env.NODE_ENV === "development";
  const DOMAIN = origin;
  const stripe = getClient();

  const ANUAL_PRICE = isDevelopment
    ? "price_1OinGRDtYmGT70YtS3fKsenE"
    : "price_1OgF7RDtYmGT70YtcGL3AxDQ"; // prod

  const MONTHLY_PLAN = isDevelopment
    ? "price_1OinFxDtYmGT70YtW9UbUdpM"
    : "price_1OgF7RDtYmGT70YtJB3kRl9T"; // prod

  // price_1MowQULkdIwHu7ixraBm864M

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: await getOrCreateCustomerId(user),
    success_url: `${DOMAIN}/profile?success=1`,
    discounts: { coupon },
    line_items: [
      {
        price: price || ANUAL_PRICE,
        quantity: 1,
      },
    ],
  });

  return session.url;
};

export const getStripeURL = async (
  request: Request,
  type: "month" | "year" = "year"
) => {
  let price;
  if (type === "month") {
    price = MONTHLY_PLAN;
  }

  const user = await getUserOrTriggerLogin(request); // @todo revisit
  const url = await createCheckoutSessionURL({
    user,
    price,
    origin: new URL(request.url).origin,
  });
  return url;
};

let stripeClient;
export const getClient = () => {
  const isDev = process.env.NODE_ENV === "development";
  stripeClient ??= new Stripe(
    (isDev ? process.env.TEST_STRIPE_PV : process.env.STRIPE_PRIVATE_KEY) ?? ""
  );
  return stripeClient;
};
