import { createFileRoute } from "@tanstack/react-router"
import { LEGAL } from "@/components/legal/legal-facts"
import { LegalPage, type LegalSection } from "@/components/legal/legal-page"

// Public: no beforeLoad, no auth guard. The root layout renders this route
// without the app shell for signed-in and signed-out visitors alike.
export const Route = createFileRoute("/terms")({
  component: TermsPage,
})

const sections: LegalSection[] = [
  {
    id: "agreement",
    title: "Agreement to these terms",
    body: (
      <>
        <p>
          These Terms of Service (the "Terms") are a binding agreement between
          you and {LEGAL.company} ({LEGAL.legalEntity}), referred to as "we",
          "us" or "{LEGAL.company}". They govern your use of the{" "}
          {LEGAL.product} platform: the web console, the REST API and SDKs, the
          device agent and install script, the websites and documentation, and
          any related services (together, the "Services").
        </p>
        <p>
          By creating an account, enrolling a device or otherwise using the
          Services you agree to these Terms and to our{" "}
          <a href="/privacy">Privacy Policy</a>. If you are using the Services
          on behalf of an organization, you represent that you have authority
          to bind that organization, and "you" refers to both you and the
          organization. If you do not agree, do not use the Services.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Accounts and organizations",
    body: (
      <>
        <p>
          You must be at least 18 years old and able to form a binding contract
          to use the Services. You must provide accurate account information
          and keep it current.
        </p>
        <p>
          Resources in {LEGAL.product} belong to an organization. Organizations
          contain workspaces, and workspaces contain devices. The owner of an
          organization controls who is a member and what role they hold.
          Owners and admins can invite and remove members, enroll and delete
          devices, issue and revoke API keys, manage workflows, view live video
          and send remote commands. Members have read-level access. You are
          responsible for the roles you assign and for everything done in your
          organization by the people you admit to it.
        </p>
        <p>
          You are responsible for safeguarding your password, API keys, session
          tokens and device certificates, and for all activity that occurs
          under them. Tell us promptly at {LEGAL.contactEmail} if you believe a
          credential has been compromised.
        </p>
      </>
    ),
  },
  {
    id: "devices",
    title: "Devices and the device agent",
    body: (
      <>
        <p>
          You enroll hardware by generating a claim code in the console and
          running the {LEGAL.product} install script on a device you own or are
          authorized to manage. The script installs the device agent, obtains a
          device-specific certificate and starts a background service. You
          grant us permission to install, run, configure and update the agent
          on devices you enroll for as long as they remain enrolled.
        </p>
        <p>
          Owners and admins of an organization can push configuration, trigger
          agent updates and issue remote commands, including reboot and power
          off, to enrolled devices. A remote power-off cannot be undone
          remotely; someone must physically restart the device. You are
          responsible for the physical consequences of commands sent to your
          devices.
        </p>
        <p>
          The device agent is provided for use on hardware and operating
          systems we document as supported. Cellular connectivity, SIM cards,
          data plans, cameras, antennas and power are your responsibility. We
          do not guarantee that the agent will work on unsupported hardware or
          under every network condition.
        </p>
      </>
    ),
  },
  {
    id: "customer-data",
    title: "Your data",
    body: (
      <>
        <p>
          Telemetry, video, configuration, workflow templates, workflow output
          and any other content that you or your devices send to the Services
          is "Customer Data". As between you and {LEGAL.company}, you own
          Customer Data. You grant us a worldwide, non-exclusive licence to
          host, store, process, transmit, display and create derived outputs
          (such as thumbnails and workflow events) from Customer Data solely to
          provide, secure and improve the Services and as otherwise permitted
          by the Privacy Policy. We do not use Customer Data to train
          machine-learning models.
        </p>
        <p>
          You are solely responsible for Customer Data, including for having
          the rights and lawful basis to collect it. Devices that capture
          video or location can record people who are not our users. You must
          deploy devices in compliance with all applicable privacy,
          surveillance, recording, road-safety and employment laws, including
          any obligation to give notice, post signage or obtain consent, and
          you must not use the Services to monitor anyone unlawfully.
        </p>
        <p>
          You can export Customer Data through the API and delete it by
          deleting the device, session, workspace or organization it belongs
          to. Recorded video is retained for a fixed period after upload and
          then deleted automatically; the Privacy Policy describes current
          retention periods. Retention and storage limits are not guaranteed
          service levels and may change with reasonable notice.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <>
        <p>You agree not to, and not to allow anyone else to:</p>
        <ul>
          <li>
            Use the Services in violation of any law, or to infringe, harass,
            stalk, or invade the privacy of any person.
          </li>
          <li>
            Enroll hardware you do not own or lack authority to manage, or
            send commands to devices you are not authorized to control.
          </li>
          <li>
            Probe, scan, or test the vulnerability of the Services, bypass
            authentication or access controls, or access another
            organization's data, except through a security-testing arrangement
            we have agreed to in writing.
          </li>
          <li>
            Interfere with the Services or place unreasonable load on them,
            including by exceeding documented rate or size limits, publishing
            malformed telemetry, or flooding ingest or command topics.
          </li>
          <li>
            Reverse engineer, decompile or attempt to extract the source of
            the Services except where the law expressly permits or where the
            component is published under an open-source licence.
          </li>
          <li>
            Resell, sublicense or provide the Services to third parties as a
            standalone offering, other than as part of your own product built
            on the API and SDKs in accordance with Section 6.
          </li>
          <li>
            Use the Services in any application where failure could lead to
            death, personal injury or severe environmental damage, including
            as a safety-of-life system, without our written agreement.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "api",
    title: "API, SDKs and building on Xorgate",
    body: (
      <>
        <p>
          You may use the REST API, session tokens and the published SDKs to
          build your own applications, including applications you offer to
          your own customers. You are responsible for those applications, for
          the people who use them, and for keeping any API key or credential
          you embed in them confidential. Session tokens exist so that your
          end users never need to hold your API key; do not ship API keys to
          browsers or devices you do not control.
          </p>
        <p>
          Our SDK packages are published under their own open-source licence
          (currently MIT). That licence governs the SDK code; these Terms
          govern your use of the hosted Services the SDK talks to.
        </p>
        <p>
          The API and SDKs are under active development. We may change,
          deprecate or version endpoints and packages. We will try to give
          reasonable notice of breaking changes through the documentation or
          release notes.
        </p>
      </>
    ),
  },
  {
    id: "third-party",
    title: "Third-party providers you connect",
    body: (
      <p>
        Workflows can call third-party services (for example an AI model
        provider or a road-data provider) using credentials you supply. Your
        use of those services is governed by their terms, you are responsible
        for any fees they charge and for the data you send them, and we are
        not responsible for their availability, accuracy or conduct. Some
        providers impose their own usage limits, which the Services may
        enforce on your behalf.
      </p>
    ),
  },
  {
    id: "fees",
    title: "Plans and fees",
    body: (
      <>
        <p>
          Some features of the Services may be offered free of charge and
          others under paid plans. Published plan limits such as retention
          periods and storage quotas describe what we intend to provide and may
          be adjusted with reasonable notice. Where a paid plan applies, you
          agree to pay the fees stated for it, and fees are non-refundable
          except as required by law or expressly stated in writing.
        </p>
        <p>
          Self-serve billing is in development. Until it is available, paid
          plans, if any, are arranged directly with us in writing.
        </p>
      </>
    ),
  },
  {
    id: "ip",
    title: "Our intellectual property",
    body: (
      <p>
        The Services, including the console, backend, device agent, install
        script, documentation, designs and the {LEGAL.product} name and logo,
        are owned by {LEGAL.company} or its licensors and are protected by
        intellectual-property law. Except for the limited rights expressly
        granted in these Terms and in any open-source licence that covers a
        particular component, no rights are granted to you. If you send us
        feedback or suggestions, you grant us a perpetual, royalty-free right
        to use them without obligation to you.
      </p>
    ),
  },
  {
    id: "availability",
    title: "Service changes and availability",
    body: (
      <>
        <p>
          The Services are evolving. We may add, change or remove features,
          and we may suspend the Services for maintenance, to address security
          risks, or where required by law. We will try to give notice of
          changes that materially reduce functionality.
        </p>
        <p>
          The Services depend on networks and devices we do not control. Live
          video, telemetry delivery, remote commands and recording uploads can
          be delayed or fail when a device is offline, out of cellular
          coverage, out of power or out of storage. Do not rely on the
          Services as the only means of monitoring anything whose failure
          would cause harm.
        </p>
      </>
    ),
  },
  {
    id: "termination",
    title: "Suspension and termination",
    body: (
      <>
        <p>
          You may stop using the Services at any time and may delete your
          organizations, workspaces and devices from the console or API. To
          close your account, email {LEGAL.contactEmail}.
        </p>
        <p>
          We may suspend or terminate your access, with notice where
          practicable, if you materially breach these Terms, if your use
          creates a security or legal risk for us or others, if required by
          law, or if you have not paid fees that are due. We may also
          discontinue the Services with reasonable notice.
        </p>
        <p>
          On termination your right to use the Services ends, enrolled devices
          will lose their connection to the platform, and we may delete
          Customer Data after a reasonable wind-down period. Sections that by
          their nature should survive (including Sections 4, 9, 12, 13 and 14)
          survive termination.
        </p>
      </>
    ),
  },
  {
    id: "warranty",
    title: "Disclaimer of warranties",
    body: (
      <p>
        THE SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE". TO THE FULLEST
        EXTENT PERMITTED BY LAW, {LEGAL.company.toUpperCase()} DISCLAIMS ALL
        WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF
        MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE AND
        NON-INFRINGEMENT, AND ANY WARRANTY THAT THE SERVICES WILL BE
        UNINTERRUPTED, ERROR-FREE, SECURE OR THAT DATA WILL NOT BE LOST. THE
        OUTPUT OF WORKFLOWS, INCLUDING MACHINE-LEARNING DETECTIONS AND EVENTS,
        MAY BE INACCURATE OR INCOMPLETE AND MUST NOT BE RELIED ON WITHOUT
        INDEPENDENT VERIFICATION.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <p>
        TO THE FULLEST EXTENT PERMITTED BY LAW, {LEGAL.company.toUpperCase()}{" "}
        AND ITS OFFICERS, DIRECTORS, EMPLOYEES AND SUPPLIERS WILL NOT BE
        LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE
        DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA, GOODWILL OR USE,
        ARISING OUT OF OR RELATING TO THE SERVICES, HOWEVER CAUSED AND UNDER ANY
        THEORY OF LIABILITY, EVEN IF ADVISED OF THE POSSIBILITY. OUR TOTAL
        LIABILITY FOR ALL CLAIMS RELATING TO THE SERVICES WILL NOT EXCEED THE
        GREATER OF THE AMOUNT YOU PAID US FOR THE SERVICES IN THE TWELVE MONTHS
        BEFORE THE CLAIM AND ONE HUNDRED CANADIAN DOLLARS (CAD $100). SOME
        JURISDICTIONS DO NOT ALLOW CERTAIN LIMITATIONS, SO SOME OF THE ABOVE
        MAY NOT APPLY TO YOU.
      </p>
    ),
  },
  {
    id: "indemnity",
    title: "Indemnification",
    body: (
      <p>
        You will defend, indemnify and hold harmless {LEGAL.company} and its
        officers, directors, employees and agents from any claims, damages,
        losses and expenses (including reasonable legal fees) arising out of
        or relating to Customer Data, your deployment or operation of devices,
        applications you build on the API or SDKs, your breach of these Terms,
        or your violation of any law or of the rights of any person.
      </p>
    ),
  },
  {
    id: "law",
    title: "Governing law and disputes",
    body: (
      <>
        <p>
          These Terms are governed by the laws of Canada and of the province in
          which {LEGAL.legalEntity} has its principal place of business, without
          regard to conflict-of-law rules. The courts of that province have
          exclusive jurisdiction over any dispute arising out of these Terms
          or the Services, and you consent to their jurisdiction, except that
          either party may seek injunctive relief in any court of competent
          jurisdiction to protect its intellectual property or confidential
          information.
        </p>
        <p>
          Before starting formal proceedings, you agree to contact us at{" "}
          {LEGAL.contactEmail} and make a good-faith attempt to resolve the
          dispute informally for at least 30 days.
        </p>
      </>
    ),
  },
  {
    id: "general",
    title: "General",
    body: (
      <>
        <p>
          These Terms, together with the Privacy Policy and any written
          agreement you have signed with us, are the entire agreement between
          you and {LEGAL.company} about the Services. If a signed agreement
          conflicts with these Terms, the signed agreement controls. If any
          provision is found unenforceable, the rest remains in effect. Our
          failure to enforce a provision is not a waiver. You may not assign
          these Terms without our consent; we may assign them in connection
          with a merger, acquisition or sale of assets. Neither party is liable
          for delay or failure caused by events beyond its reasonable control.
        </p>
        <p>
          We may update these Terms. When we do, we will change the effective
          date above and, for material changes, notify you by email or through
          the console before they take effect. Continued use of the Services
          after a change takes effect means you accept the updated Terms.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        {LEGAL.company} ({LEGAL.legalEntity})
        <br />
        <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>
        <br />
        <a href={LEGAL.site}>{LEGAL.site}</a>
      </p>
    ),
  },
]

function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      summary={`The agreement that governs your use of the ${LEGAL.product} console, API, SDKs and device agent, operated by ${LEGAL.company}.`}
      current="/terms"
      sections={sections}
    />
  )
}
