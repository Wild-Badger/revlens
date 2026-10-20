import { PrismaClient, Prisma, type Customer } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Seeded deterministic random generator
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const rand = seededRandom(42);

function choice<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function randDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + rand() * (end.getTime() - start.getTime()));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

const INDUSTRIES = [
  "Software", "Fintech", "Healthcare", "E-commerce", "SaaS",
  "AI/ML", "Cybersecurity", "EdTech", "Gaming", "Logistics",
];

const COMPANY_SIZES = ["<10", "10-50", "50-200", "200-1000", "1000+"];

const COUNTRIES = ["US", "GB", "DE", "FR", "CA", "AU", "NL", "SE", "SG", "JP"];

const CHANNELS = ["organic", "paid", "referral", "outbound", "partner"];

const PLAN_CONFIGS = [
  { name: "Starter", billingInterval: "monthly", basePrice: 49, seatPrice: 10 },
  { name: "Starter", billingInterval: "annual", basePrice: 470, seatPrice: 10 },
  { name: "Growth", billingInterval: "monthly", basePrice: 199, seatPrice: 20 },
  { name: "Growth", billingInterval: "annual", basePrice: 1910, seatPrice: 20 },
  { name: "Enterprise", billingInterval: "monthly", basePrice: 599, seatPrice: 50 },
  { name: "Enterprise", billingInterval: "annual", basePrice: 5750, seatPrice: 50 },
];

async function main() {
  if (process.env.DEMO_MODE !== "true") {
    throw new Error("The synthetic seed requires DEMO_MODE=true and a dedicated demo database.");
  }
  console.log("Seeding RevLens data...");

  // Seed admin user
  const adminEmail = "admin@revlens.dev";
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash("admin123456", 12);
    await prisma.user.create({
      data: {
        name: "Admin User",
        email: adminEmail,
        password: hashedPassword,
        role: "admin",
      },
    });
    console.log("Seeded admin user (admin@revlens.dev / admin123456)");
  }

  await prisma.productEvent.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.customer.deleteMany();

  // Create plans
  const plans = await Promise.all(
    PLAN_CONFIGS.map((p) =>
      prisma.plan.create({
        data: {
          name: p.name,
          billingInterval: p.billingInterval,
          basePrice: new Prisma.Decimal(p.basePrice),
          seatPrice: new Prisma.Decimal(p.seatPrice),
        },
      })
    )
  );

  const monthlyStarter = plans.find((p) => p.name === "Starter" && p.billingInterval === "monthly")!;
  const monthlyGrowth = plans.find((p) => p.name === "Growth" && p.billingInterval === "monthly")!;
  const monthlyEnterprise = plans.find((p) => p.name === "Enterprise" && p.billingInterval === "monthly")!;
  const annualStarter = plans.find((p) => p.name === "Starter" && p.billingInterval === "annual")!;

  const now = new Date(process.env.DEMO_AS_OF ?? "2026-09-30T23:59:59.999Z");
  const sixMonthsAgo = addMonths(now, -6);

  const customersData: Customer[] = [];

  // 60 customers
  for (let i = 0; i < 60; i++) {
    const createdAt = randDate(addMonths(sixMonthsAgo, -6), addMonths(now, -5));
    const willConvert = rand() > 0.15;
    const convertedAt = willConvert ? randDate(createdAt, addDays(createdAt, 30)) : null;

    let status = "lead";
    let churnedAt = null;

    if (convertedAt) {
      const churnRoll = rand();
      if (churnRoll > 0.25) {
        status = "active";
      } else if (churnRoll > 0.12) {
        status = "churned";
        churnedAt = randDate(addDays(convertedAt, 30), addDays(convertedAt, 150));
      } else {
        status = "reactivated";
        churnedAt = randDate(addDays(convertedAt, 30), addDays(convertedAt, 120));
      }
    }

    const customer = await prisma.customer.create({
      data: {
        name: `${["Alder", "Bramble", "Cedar", "Drift", "Elm", "Field", "Grove", "Harbor", "Iris", "Juniper"][i % 10]} ${["Labs", "Studio", "Systems", "Works", "Cloud", "Digital"][Math.floor(i / 10)]}`,
        domain: `customer${i + 1}.example`,
        industry: choice(INDUSTRIES),
        companySize: choice(COMPANY_SIZES),
        country: choice(COUNTRIES),
        acquisitionChannel: choice(CHANNELS),
        createdAt,
        convertedAt,
        churnedAt,
        status,
      },
    });
    customersData.push({ ...customer, convertedAt, churnedAt, status });
  }

  let totalSubscriptions = 0;

  for (const customer of customersData) {
    if (!customer.convertedAt) continue;

    const scenarioRoll = rand();
    let subScenario: "new" | "expansion" | "contraction" | "churn" | "reactivation" | "failed_payments";

    if (scenarioRoll < 0.2) subScenario = "new";
    else if (scenarioRoll < 0.4) subScenario = "expansion";
    else if (scenarioRoll < 0.55) subScenario = "contraction";
    else if (scenarioRoll < 0.7) subScenario = "churn";
    else if (scenarioRoll < 0.85) subScenario = "reactivation";
    else subScenario = "failed_payments";

    let currentPlan = choice([monthlyStarter, monthlyGrowth, monthlyEnterprise]);
    let currentSeats = randInt(1, 20);
    let subStart = customer.convertedAt;

    // First subscription
    const mrr1 = currentPlan.billingInterval === "annual"
      ? currentPlan.basePrice.div(12).plus(currentPlan.seatPrice.times(currentSeats).div(12))
      : currentPlan.basePrice.plus(currentPlan.seatPrice.times(currentSeats));

    let endedAt1: Date | null = null;
    if (subScenario === "churn" || subScenario === "reactivation") {
      endedAt1 = randDate(addDays(subStart, 45), addDays(now, subScenario === "reactivation" ? -90 : -1));
    } else if (subScenario === "expansion" || subScenario === "contraction") {
      endedAt1 = randDate(addDays(subStart, 45), addDays(subStart, 120));
    } else if (subScenario === "failed_payments") {
      endedAt1 = null; // keep active but generate failed invoices
    }

    await prisma.subscription.create({
      data: {
        customerId: customer.id,
        planId: currentPlan.id,
        status: endedAt1 ? "cancelled" : "active",
        startedAt: subStart,
        endedAt: endedAt1,
        billingInterval: currentPlan.billingInterval,
        currentMrr: mrr1,
        seats: currentSeats,
      },
    });
    totalSubscriptions++;

    // Expansion scenario: upgrade plan or add seats
    if (subScenario === "expansion") {
      subStart = endedAt1!;
      if (currentPlan.name === "Starter") currentPlan = monthlyGrowth;
      else if (currentPlan.name === "Growth") currentPlan = monthlyEnterprise;
      else currentSeats += randInt(2, 10);

      const mrr2 = currentPlan.billingInterval === "annual"
        ? currentPlan.basePrice.div(12).plus(currentPlan.seatPrice.times(currentSeats).div(12))
        : currentPlan.basePrice.plus(currentPlan.seatPrice.times(currentSeats));

      await prisma.subscription.create({
        data: {
          customerId: customer.id,
          planId: currentPlan.id,
          status: "active",
          startedAt: subStart,
          endedAt: null,
          billingInterval: currentPlan.billingInterval,
          currentMrr: mrr2,
          seats: currentSeats,
        },
      });
      totalSubscriptions++;
    }

    // Contraction scenario: downgrade plan or reduce seats
    if (subScenario === "contraction") {
      subStart = endedAt1!;
      if (currentPlan.name === "Enterprise") currentPlan = monthlyGrowth;
      else if (currentPlan.name === "Growth") currentPlan = monthlyStarter;
      currentSeats = Math.max(1, currentSeats - randInt(1, 5));

      const mrr2 = currentPlan.billingInterval === "annual"
        ? currentPlan.basePrice.div(12).plus(currentPlan.seatPrice.times(currentSeats).div(12))
        : currentPlan.basePrice.plus(currentPlan.seatPrice.times(currentSeats));

      await prisma.subscription.create({
        data: {
          customerId: customer.id,
          planId: currentPlan.id,
          status: "active",
          startedAt: subStart,
          endedAt: null,
          billingInterval: currentPlan.billingInterval,
          currentMrr: mrr2,
          seats: currentSeats,
        },
      });
      totalSubscriptions++;
    }

    // Reactivation scenario: add a new subscription after churn
    if (subScenario === "reactivation") {
      const reactivatedAt = addDays(endedAt1!, randInt(15, 60));
      currentPlan = choice([monthlyStarter, monthlyGrowth, monthlyEnterprise]);
      currentSeats = randInt(1, 15);

      const mrr2 = currentPlan.billingInterval === "annual"
        ? currentPlan.basePrice.div(12).plus(currentPlan.seatPrice.times(currentSeats).div(12))
        : currentPlan.basePrice.plus(currentPlan.seatPrice.times(currentSeats));

      await prisma.subscription.create({
        data: {
          customerId: customer.id,
          planId: currentPlan.id,
          status: "active",
          startedAt: reactivatedAt,
          endedAt: null,
          billingInterval: currentPlan.billingInterval,
          currentMrr: mrr2,
          seats: currentSeats,
        },
      });
      totalSubscriptions++;
    }

    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        status: subScenario === "churn" ? "churned" : subScenario === "reactivation" ? "reactivated" : "active",
        churnedAt: subScenario === "churn" || subScenario === "reactivation" ? endedAt1 : null,
      },
    });

    // Failed payments scenario: keep active subscription, generate some failed invoices
    // handled in invoice generation below
  }

  // Generate invoices and payments for all subscriptions
  const allSubscriptions = await prisma.subscription.findMany();
  for (const sub of allSubscriptions) {
    const customer = customersData.find((c) => c.id === sub.customerId);
    const months = Math.ceil(
      ((sub.endedAt ? new Date(sub.endedAt).getTime() : now.getTime()) -
        new Date(sub.startedAt).getTime()) /
        (1000 * 60 * 60 * 24 * 30)
    );

    for (let m = 0; m < months; m++) {
      const invoiceDate = addMonths(startOfMonth(sub.startedAt), m);
      if (invoiceDate > now) break;

      // For failed payment scenario, make some invoices fail
      const isFailedPaymentScenario = customer && customer.status === "active" && rand() < 0.15;
      const status = isFailedPaymentScenario
        ? (rand() > 0.5 ? "failed" : "open")
        : (rand() > 0.05 ? "paid" : "open");

      const paidAt = status === "paid" ? addDays(invoiceDate, randInt(1, 10)) : null;
      const failedAt = status === "failed" ? addDays(invoiceDate, randInt(3, 15)) : null;

      const invoice = await prisma.invoice.create({
        data: {
          customerId: sub.customerId,
          subscriptionId: sub.id,
          amount: sub.currentMrr,
          currency: "USD",
          status,
          invoiceDate,
          paidAt,
          failedAt,
        },
      });

      if (status === "paid") {
        await prisma.payment.create({
          data: {
            invoiceId: invoice.id,
            customerId: sub.customerId,
            amount: sub.currentMrr,
            status: "succeeded",
            paymentMethod: choice(["card", "ach", "wire"]),
            processedAt: paidAt!,
          },
        });
      }

      if (status === "failed") {
        await prisma.payment.create({
          data: {
            invoiceId: invoice.id,
            customerId: sub.customerId,
            amount: sub.currentMrr,
            status: "failed",
            paymentMethod: choice(["card", "ach", "wire"]),
            processedAt: failedAt!,
          },
        });
      }
    }
  }

  // Generate product events for converted customers
  for (const customer of customersData) {
    if (!customer.convertedAt) continue;

    const eventCount = randInt(10, 200);
    for (let e = 0; e < eventCount; e++) {
      const eventDate = randDate(customer.createdAt, now);
      await prisma.productEvent.create({
        data: {
          customerId: customer.id,
          userId: `user-${randInt(1, 50)}`,
          eventName: choice(["login", "feature_used", "report_viewed", "integration_connected", "team_invited"]),
          properties: { source: "web", page: "/dashboard" },
          timestamp: eventDate,
        },
      });
    }
  }

  console.log(`Seeded ${customersData.length} customers, ${plans.length} plans, ${totalSubscriptions} subscriptions.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
