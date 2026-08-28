import { createFileRoute } from "@tanstack/react-router"
import { LEGAL } from "@/components/legal/legal-facts"
import { LegalPage, type LegalSection } from "@/components/legal/legal-page"

// Public: no beforeLoad, no auth guard. The root layout renders this route
// without the app shell for signed-in and signed-out visitors alike.
export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
})

const sections: LegalSection[] = [
  {
    id: "scope",
    title: "Who we are and what this covers",
    body: (
      <>
        <p>
          {LEGAL.product} is operated by {LEGAL.company} ({LEGAL.legalEntity}),
          referred to here as "we", "us" or "{LEGAL.company}". This Privacy
          Policy explains what personal information we collect when you use
          the {LEGAL.product} platform, why we collect it, and the choices you
          have.
        </p>
        <p>
          It covers the {LEGAL.product} web console, the {LEGAL.product} REST
          API and SDKs, the {LEGAL.product} device agent that runs on hardware
          you enroll, and the {LEGAL.product} websites and documentation
          (together, the "Services").
        </p>
        <p>
          {LEGAL.product} is a business platform. Most of the data that flows
          through it (device telemetry, video, workflow output) belongs to the
          organization that enrolled the devices, not to us. Where that data
          includes personal information about people your devices observe,
          your organization is the controller of that information and we
          process it on your organization's behalf under the{" "}
          <a href="/terms">Terms of Service</a>. Section 4 describes that
          arrangement.
        </p>
      </>
    ),
  },
  {
    id: "information-you-provide",
    title: "Information you give us",
    body: (
      <>
        <h3>Account information</h3>
        <p>
          When you create an account we collect your email address and, if you
          provide one, your name. If you sign in with Google, Google shares
          your email address and profile name with us and we use them to
          create or link your account. We never see your Google password. Your
          email address is also used for account recovery.
        </p>
        <h3>Organization and workspace information</h3>
        <p>
          The names you give organizations, workspaces, devices, device models
          and workflow templates, and the membership roles you assign to other
          people in your organization (owner, admin or member). Inviting a
          member means sharing that person's email address with us.
        </p>
        <h3>Credentials you issue or bring</h3>
        <p>
          API keys and short-lived session tokens that the platform issues to
          you are stored only as a one-way hash; the full value is shown once
          and cannot be recovered by us. If you connect a third-party provider
          to a workflow (for example a map or AI provider), the credential you
          supply is stored encrypted in a per-organization secret and is
          write-only: the console only ever reports that it exists and when it
          was last rotated.
        </p>
        <h3>Support and correspondence</h3>
        <p>
          Anything you send to {LEGAL.contactEmail} or otherwise share with us
          when asking for help.
        </p>
      </>
    ),
  },
  {
    id: "device-data",
    title: "Information collected by the device agent",
    body: (
      <>
        <p>
          The {LEGAL.product} device agent runs on hardware that you or your
          organization own and enroll with a claim code. Once enrolled, the
          agent publishes the following to the platform over a mutually
          authenticated connection, typically once per second:
        </p>
        <ul>
          <li>
            <strong>Location and motion:</strong> GNSS position (latitude,
            longitude, altitude), speed, heading, fix quality and satellite
            statistics, plus inertial measurements (orientation and
            acceleration) from the on-board IMU.
          </li>
          <li>
            <strong>Connectivity:</strong> cellular signal strength and quality,
            modem temperature, registration state, carrier and access point
            name, and the SIM card's ICCID.
          </li>
          <li>
            <strong>Device health:</strong> CPU, memory, disk and temperature
            readings, power-rail status, agent version and the state of the
            recording and streaming subsystems.
          </li>
          <li>
            <strong>Hardware identifiers:</strong> at enrollment the install
            script sends the machine ID (or, failing that, the board UUID or
            hostname) as the device serial, along with the hostname, platform
            architecture, board model and the list of attached cameras.
          </li>
          <li>
            <strong>Video:</strong> when a camera is attached and recording is
            enabled, the device records short video segments locally and
            uploads them to our storage. When you open a live view, video is
            streamed peer-to-peer from the device to your browser; we relay
            the connection setup, and where a direct path is not possible the
            stream is relayed through a TURN server, but live video is not
            recorded or retained by us.
          </li>
        </ul>
        <p>
          The device agent does not capture audio. A microphone, if present, is
          not used by the product.
        </p>
        <p>
          Note that the SIM ICCID identifies a cellular subscription, not just
          a piece of hardware. It is shown in the device settings page to
          members of your organization who can view the device.
        </p>
      </>
    ),
  },
  {
    id: "customer-data",
    title: "Data your devices observe about other people",
    body: (
      <>
        <p>
          Cameras and location sensors can capture personal information about
          people who are not {LEGAL.product} users: pedestrians, drivers,
          workers, visitors. We do not decide what your devices point at or
          where they go. Your organization is responsible for deploying
          devices lawfully, which includes providing any notice, signage or
          consent that applicable law requires, and for configuring recording
          and workflows appropriately.
        </p>
        <p>
          We process that data only to provide the Services to your
          organization: storing and indexing recorded segments, generating a
          single downscaled thumbnail frame per recording session, running the
          workflows you configure, and making the results available to your
          organization's members through the console and API. We do not use
          your device data to train models, build profiles or sell to third
          parties.
        </p>
        <p>
          Workflows you build may send data outside the platform. In
          particular, a vision-language model node sends video frames and your
          prompt to the AI provider whose credential you configured, and a
          road-data node sends GPS coordinates to the map provider you chose.
          Those transfers happen under your organization's own account with
          that provider and are governed by that provider's terms.
        </p>
      </>
    ),
  },
  {
    id: "automatic",
    title: "Information collected automatically",
    body: (
      <>
        <p>
          <strong>Service logs.</strong> Our servers keep operational logs of
          API requests and device ingest activity (timestamps, request paths,
          identifiers, status codes and error details). We use them to run,
          secure and debug the Services.
        </p>
        <p>
          <strong>Browser storage.</strong> The console keeps your sign-in
          session, your theme choice and your sidebar preference in your
          browser's local storage and one first-party cookie (
          <code>sidebar_state</code>). If you sign in with Google, the Google
          and Amazon Cognito sign-in pages set their own cookies on their own
          domains.
        </p>
        <p>
          <strong>No advertising or analytics trackers.</strong> The console
          does not load third-party analytics, advertising or session-replay
          scripts. Map tiles in the console are fetched from Mapbox, which
          receives your IP address and the map area you are viewing in order
          to serve them.
        </p>
      </>
    ),
  },
  {
    id: "use",
    title: "How we use information",
    body: (
      <>
        <ul>
          <li>To create and secure your account and authenticate you.</li>
          <li>
            To provide the Services: enrolling devices, ingesting and
            displaying telemetry, storing and replaying recordings, running
            workflows, and delivering results through the console, API and
            SDKs.
          </li>
          <li>
            To enforce access control, so that only members of your
            organization, in the roles you assign, can reach your data.
          </li>
          <li>
            To operate, monitor, troubleshoot and improve the reliability and
            security of the Services.
          </li>
          <li>To respond to your requests and support inquiries.</li>
          <li>
            To send service messages such as account verification, security
            notices and material changes to the Services or these terms.
          </li>
          <li>To comply with law and enforce our Terms of Service.</li>
        </ul>
        <p>
          We do not sell personal information, and we do not use it for
          third-party advertising.
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "How we share information",
    body: (
      <>
        <p>
          <strong>Within your organization.</strong> Device data, workflow
          output and member email addresses are visible to other members of
          the same organization according to their role. Live video and remote
          device commands are further restricted to owners and admins.
        </p>
        <p>
          <strong>Service providers.</strong> We host the Services on Amazon
          Web Services in the {LEGAL.region} region, using services such as
          Cognito (sign-in), IoT Core (device messaging), Kinesis Video Streams
          (live-video signalling and relay), S3 (storage), Aurora (database),
          Lambda and Fargate (compute) and CloudWatch (logs). Google provides
          optional sign-in. Mapbox serves map tiles in the console. These
          providers process data only as needed to provide their services to
          us.
        </p>
        <p>
          <strong>Providers you connect.</strong> Where you configure a
          workflow to call a third-party AI or map provider, the data that
          node sends goes to that provider under your own account with them.
        </p>
        <p>
          <strong>Legal and safety.</strong> We may disclose information if
          required by law, subpoena or court order, or where we believe in good
          faith that disclosure is necessary to protect the rights, property or
          safety of {LEGAL.company}, our users or the public.
        </p>
        <p>
          <strong>Business transfers.</strong> If {LEGAL.company} is involved in
          a merger, acquisition, financing or sale of assets, information may
          be transferred as part of that transaction, subject to this policy.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep information",
    body: (
      <>
        <ul>
          <li>
            <strong>Recorded video segments</strong> are deleted from storage
            90 days after upload, and the index entries that point to them are
            removed shortly after. You can delete an individual recording
            session at any time from the console or API, and you can turn
            recording off per device. Devices also cap the size of their local
            recording store and discard the oldest segments first.
          </li>
          <li>
            <strong>Telemetry</strong> is retained for the period associated
            with your plan. Data you upload to the workflow simulator is
            deleted after 7 days.
          </li>
          <li>
            <strong>Session tokens</strong> expire within one hour and are
            purged shortly after. <strong>Claim codes</strong> expire after 15
            minutes.
          </li>
          <li>
            <strong>Service logs</strong> are kept for a limited operational
            period and then discarded.
          </li>
          <li>
            <strong>Account information</strong> is kept for as long as your
            account exists. Deleting a device, workspace or organization
            removes the data scoped to it.
          </li>
        </ul>
        <p>
          We may keep information longer where we are required to by law or
          need it to resolve disputes or enforce our agreements.
        </p>
      </>
    ),
  },
  {
    id: "choices",
    title: "Your choices and rights",
    body: (
      <>
        <p>
          Depending on where you live, you may have rights to access, correct,
          export, restrict or delete the personal information we hold about
          you, and to object to certain processing. You can exercise many of
          these directly:
        </p>
        <ul>
          <li>
            Update your name in the console and manage which organizations you
            belong to.
          </li>
          <li>
            Export telemetry and download recordings through the REST API and
            signed download URLs.
          </li>
          <li>
            Delete devices, recording sessions, workspaces, API keys and
            organizations from the console or API.
          </li>
          <li>
            Revoke your own live-video access and revoke API keys at any time.
          </li>
        </ul>
        <p>
          To close your account entirely, or to make any other request, email{" "}
          <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>{" "}
          from the address on the account. We will verify the request and
          respond within the time required by applicable law. If you are a
          member of an organization, some requests may need to go through that
          organization, and we will tell you if so.
        </p>
        <p>
          If a device recorded you and you are not a {LEGAL.product} user, the
          organization that operates the device is the appropriate party to
          contact. If you do not know who that is, email us and we will help
          route your request where we are able to.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <>
        <p>
          Every enrolled device holds its own X.509 certificate and connects
          over mutually authenticated TLS; there are no shared device
          credentials. Data is encrypted in transit. API keys and session
          tokens are stored only as one-way hashes. Access is scoped by
          organization, workspace and role, and playback uses time-limited
          signed URLs.
        </p>
        <p>
          No system is perfectly secure. You are responsible for keeping your
          password, API keys and device hardware safe and for telling us
          promptly at {LEGAL.contactEmail} if you believe an account or device
          has been compromised.
        </p>
      </>
    ),
  },
  {
    id: "transfers",
    title: "International transfers",
    body: (
      <p>
        {LEGAL.company} operates from Canada and hosts the Services in the
        United States ({LEGAL.region}). If you use the Services from elsewhere,
        your information will be transferred to, stored and processed in those
        countries, whose laws may differ from those of your own. We rely on
        our service providers' contractual commitments and safeguards for
        those transfers.
      </p>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        The Services are intended for businesses and are not directed at
        children under 16. We do not knowingly collect personal information
        from children. If you believe a child has created an account, email us
        and we will remove it.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        We may update this policy from time to time. When we do, we will change
        the effective date above and, for material changes, notify you by email
        or through the console before they take effect. Continued use of the
        Services after a change takes effect means you accept the updated
        policy.
      </p>
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

function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      summary={`How ${LEGAL.company} collects, uses and protects information when you use the ${LEGAL.product} console, API, SDKs and device agent.`}
      current="/privacy"
      sections={sections}
    />
  )
}
