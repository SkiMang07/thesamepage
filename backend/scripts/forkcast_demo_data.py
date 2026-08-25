"""Deterministic fictional data for the Forkcast Labs demo organisation.

The module is intentionally pure: it does not connect to Supabase or mutate
anything. ``build_demo_data`` accepts the real Auth user ids created by the
runner and returns table-shaped rows ready for insertion. Dates are relative to
an explicit anchor so a reset produces a fresh, coherent demo week.

Every person, company, customer, and performance record in this file is
fictional. Customer email domains use the reserved ``.example`` namespace.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from uuid import UUID, uuid5


DEMO_SLUG = "forkcast-labs"
DEMO_ORG_NAME = "Forkcast Labs"
DEMO_MANAGER_NAME = "Jamie Vega"
DEMO_NAMESPACE = UUID("9ee5131c-b6a3-48ee-88c5-5d4d1c944f22")

SYNTHETIC_MANAGERS: dict[str, dict[str, str]] = {
    "support": {
        "email": "forkcast-support-manager@example.com",
        "full_name": "Quinn Foster",
    },
    "sales": {
        "email": "forkcast-sales-manager@example.com",
        "full_name": "Sloane Mercer",
    },
    "marketing": {
        "email": "forkcast-marketing-manager@example.com",
        "full_name": "Ari Bell",
    },
    "product": {
        "email": "forkcast-product-manager@example.com",
        "full_name": "Noor Sullivan",
    },
}


def seed_id(label: str) -> str:
    """Return a stable UUID for a logical demo object."""

    return str(uuid5(DEMO_NAMESPACE, label))


def _date(anchor: date, days: int) -> str:
    return (anchor + timedelta(days=days)).isoformat()


def _ts(anchor: date, days: int, hour: int = 12) -> str:
    value = datetime.combine(anchor + timedelta(days=days), time(hour), timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


def _scale_rows(
    config_label: str,
    config_id: str,
    foreign_key: str,
    *,
    quantitative: list[str] | None = None,
) -> list[dict[str, Any]]:
    names = ["Below bar", "Inconsistent", "Solid", "Strong", "Exceptional"]
    descriptions = [
        "Regularly misses the defined expectation without close support.",
        "Shows the behavior or result, but not yet with reliable consistency.",
        "Reliably meets the expectation for this role and level.",
        "Often exceeds the expectation and improves outcomes for others.",
        "Sets the standard and creates repeatable leverage across the team.",
    ]
    rows: list[dict[str, Any]] = []
    for point in range(1, 6):
        row = {
            "id": seed_id(f"scale:{config_label}:{point}"),
            foreign_key: config_id,
            "evaluation_point": point,
            "evaluation_name": names[point - 1],
            "description": descriptions[point - 1],
            "quantitative_output": quantitative[point - 1] if quantitative else None,
            "qualitative_output": names[point - 1],
        }
        if foreign_key == "metric_config_id":
            row.update({"is_range": False, "range_min": None, "range_max": None})
        rows.append(row)
    return rows


def build_demo_data(
    anchor: date,
    manager_ids: dict[str, str],
    manager_emails: dict[str, str],
) -> dict[str, list[dict[str, Any]]]:
    """Build the complete Forkcast dataset for an explicit demo week."""

    required_managers = {"demo", *SYNTHETIC_MANAGERS.keys()}
    if set(manager_ids) != required_managers:
        raise ValueError(f"manager_ids must contain exactly {sorted(required_managers)}")
    if set(manager_emails) != required_managers:
        raise ValueError(f"manager_emails must contain exactly {sorted(required_managers)}")

    rows: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)

    def add(table: str, logical_key: str, **values: Any) -> str:
        row_id = seed_id(logical_key)
        rows[table].append({"id": row_id, **values})
        return row_id

    org_id = add(
        "organizations",
        "org:forkcast",
        name=DEMO_ORG_NAME,
        one_on_one_cadence_days=14,
        created_at=_ts(anchor, -420),
    )

    manager_names = {
        "demo": DEMO_MANAGER_NAME,
        **{key: profile["full_name"] for key, profile in SYNTHETIC_MANAGERS.items()},
    }
    manager_roles = {
        "demo": "manager",
        "support": "manager",
        "sales": "manager",
        "marketing": "manager",
        "product": "director",
    }
    for key in ["demo", "support", "sales", "marketing", "product"]:
        rows["users"].append(
            {
                "id": manager_ids[key],
                "org_id": org_id,
                "email": manager_emails[key],
                "full_name": manager_names[key],
                "role": manager_roles[key],
                "manager_id": manager_ids["product"] if key in {"demo", "support", "sales", "marketing"} else None,
                "created_at": _ts(anchor, -360),
            }
        )

    family_names = [
        "Customer Success",
        "Customer Support",
        "Account Executive",
        "Growth Marketing",
        "Product Management",
        "Software Engineering",
    ]
    family_ids = {
        name: add(
            "role_families",
            f"role-family:{name}",
            org_id=org_id,
            name=name,
            created_at=_ts(anchor, -330),
        )
        for name in family_names
    }

    role_specs = {
        "csm-1": ("Customer Success", "Customer Success Manager", 1, 0, "Own a developing portfolio with reliable customer follow-through, clean account context, and well-run success-plan updates."),
        "csm-2": ("Customer Success", "Customer Success Manager", 2, 2, "Own a commercial portfolio end to end, diagnose risk early, align customer stakeholders, and drive measurable adoption and renewal outcomes."),
        "csm-3": ("Customer Success", "Senior Customer Success Manager", 3, 4, "Lead complex strategic accounts, coach peers through escalations, and turn strong customer judgment into repeatable team practices."),
        "support-1": ("Customer Support", "Customer Support Specialist", 1, 0, "Resolve customer issues accurately, communicate clearly, and leave the knowledge base better than you found it."),
        "support-2": ("Customer Support", "Senior Customer Support Specialist", 2, 3, "Own complex incidents, improve queue health, and coach the team toward durable resolutions rather than quick closes."),
        "ae-1": ("Account Executive", "Account Executive", 1, 1, "Run a disciplined sales process, qualify honestly, and close right-fit restaurant groups without creating avoidable post-sale surprises."),
        "ae-2": ("Account Executive", "Senior Account Executive", 2, 4, "Own complex opportunities, maintain forecast integrity, and improve deal quality across the team."),
        "marketing-2": ("Growth Marketing", "Growth Marketing Manager", 2, 3, "Build campaigns that create qualified pipeline, sharpen Forkcast's category story, and connect spend to commercial outcomes."),
        "pm-2": ("Product Management", "Product Manager", 2, 3, "Turn restaurant operating problems into clear product bets and ship measurable improvements with Engineering and GTM."),
        "eng-2": ("Software Engineering", "Software Engineer", 2, 2, "Ship dependable product increments, surface technical tradeoffs early, and improve the systems the team relies on."),
        "eng-3": ("Software Engineering", "Senior Software Engineer", 3, 5, "Lead ambiguous technical work, raise engineering quality, and make the people around you faster."),
    }
    role_ids: dict[str, str] = {}
    for key, (family, title, level, years, responsibilities) in role_specs.items():
        role_ids[key] = add(
            "role_levels",
            f"role:{key}",
            org_id=org_id,
            role_family_id=family_ids[family],
            job_role=title,
            functional_team=None,
            job_level=level,
            salary_min=None,
            salary_max=None,
            variable_bonus=family in {"Customer Success", "Account Executive"},
            variable_bonus_payout_period="quarter" if family in {"Customer Success", "Account Executive"} else None,
            variable_bonus_amount=None,
            job_responsibilities=responsibilities,
            years_experience_min=years,
            performance_scale_min=1,
            performance_scale_max=5,
            created_at=_ts(anchor, -330),
        )

    unit_specs = [
        ("gtm", "Go-to-Market", "department", None, None),
        ("product-eng", "Product & Engineering", "department", None, manager_ids["product"]),
        ("customer-success", "Customer Success", "team", "gtm", manager_ids["demo"]),
        ("support", "Support", "team", "gtm", manager_ids["support"]),
        ("sales", "Sales", "team", "gtm", manager_ids["sales"]),
        ("marketing", "Marketing", "team", "gtm", manager_ids["marketing"]),
        ("product", "Product", "team", "product-eng", manager_ids["product"]),
        ("engineering", "Engineering", "team", "product-eng", manager_ids["product"]),
    ]
    unit_ids: dict[str, str] = {key: seed_id(f"org-unit:{key}") for key, *_ in unit_specs}
    for key, name, unit_type, parent, leader in unit_specs:
        rows["org_units"].append(
            {
                "id": unit_ids[key],
                "org_id": org_id,
                "name": name,
                "unit_type": unit_type,
                "parent_unit_id": unit_ids[parent] if parent else None,
                "leader_user_id": leader,
                "created_at": _ts(anchor, -320),
            }
        )

    report_specs = [
        ("tessa", "demo", "Tessa Rowan", "tessa.rowan@forkcast.example", "csm-3", "customer-success", "Senior Customer Success Manager", -780, None),
        ("lena", "demo", "Lena Morales", "lena.morales@forkcast.example", "csm-2", "customer-success", "Customer Success Manager", -610, None),
        ("mina", "demo", "Mina Okafor", "mina.okafor@forkcast.example", "csm-2", "customer-success", "Customer Success Manager", -420, None),
        ("colin", "demo", "Colin Avery", "colin.avery@forkcast.example", "csm-2", "customer-success", "Customer Success Manager", -370, 14),
        ("benji", "demo", "Benji Park", "benji.park@forkcast.example", "csm-1", "customer-success", "Customer Success Manager", -105, 7),
        ("rae", "demo", "Rae Holloway", "rae.holloway@forkcast.example", "csm-1", "customer-success", "Onboarding Customer Success Manager", -250, None),
        ("devon", "demo", "Devon Price", "devon.price@forkcast.example", "csm-2", "customer-success", "Customer Success Manager", -520, None),
        ("jules", "support", "Jules Warren", "jules.warren@forkcast.example", "support-2", "support", "Senior Support Specialist", -620, None),
        ("mateo", "support", "Mateo Silva", "mateo.silva@forkcast.example", "support-1", "support", "Support Specialist", -280, None),
        ("nia", "support", "Nia Carter", "nia.carter@forkcast.example", "support-1", "support", "Support Specialist", -210, None),
        ("felix", "support", "Felix Grant", "felix.grant@forkcast.example", "support-1", "support", "Support Specialist", -90, None),
        ("harper", "sales", "Harper Stone", "harper.stone@forkcast.example", "ae-2", "sales", "Senior Account Executive", -690, None),
        ("eli", "sales", "Eli Navarro", "eli.navarro@forkcast.example", "ae-1", "sales", "Account Executive", -310, None),
        ("sasha", "sales", "Sasha Reed", "sasha.reed@forkcast.example", "ae-1", "sales", "Account Executive", -240, None),
        ("owen", "sales", "Owen Blake", "owen.blake@forkcast.example", "ae-1", "sales", "Account Executive", -160, None),
        ("wren", "marketing", "Wren Ellis", "wren.ellis@forkcast.example", "marketing-2", "marketing", "Content Marketing Manager", -480, None),
        ("cora", "marketing", "Cora Bennett", "cora.bennett@forkcast.example", "marketing-2", "marketing", "Demand Generation Manager", -300, None),
        ("theo", "marketing", "Theo Lane", "theo.lane@forkcast.example", "marketing-2", "marketing", "Product Marketing Manager", -140, None),
        ("dana", "product", "Dana Cho", "dana.cho@forkcast.example", "pm-2", "product", "Product Manager", -550, None),
        ("remy", "product", "Remy Patel", "remy.patel@forkcast.example", "eng-3", "engineering", "Senior Software Engineer", -700, None),
        ("imani", "product", "Imani Wells", "imani.wells@forkcast.example", "eng-2", "engineering", "Software Engineer", -390, None),
        ("luca", "product", "Luca Byrne", "luca.byrne@forkcast.example", "eng-2", "engineering", "Software Engineer", -260, None),
        ("freya", "product", "Freya Kent", "freya.kent@forkcast.example", "eng-2", "engineering", "Software Engineer", -120, None),
    ]
    report_ids: dict[str, str] = {}
    for key, manager, name, email, role, unit, title, start_offset, cadence in report_specs:
        report_ids[key] = add(
            "direct_reports",
            f"report:{key}",
            org_id=org_id,
            manager_id=manager_ids[manager],
            user_id=None,
            name=name,
            email=email,
            role_level_id=role_ids[role],
            org_unit_id=unit_ids[unit],
            role_title=title,
            notes=None,
            start_date=_date(anchor, start_offset),
            one_on_one_cadence_days=cadence,
            archived_at=None,
            created_at=_ts(anchor, start_offset),
        )
        add(
            "manager_report_connections",
            f"connection:{manager}:{key}",
            manager_id=manager_ids[manager],
            direct_report_id=report_ids[key],
            connection_type="direct",
            created_at=_ts(anchor, start_offset),
        )

    expectation_specs = [
        ("metric", "csm1-portfolio", "csm-1", "Portfolio hygiene", "secondary", "Keep account plans, stakeholders, next steps, and risks current enough that another teammate can understand the portfolio without a scavenger hunt.", "week", "At least 90% of assigned accounts updated in the prior 14 days."),
        ("metric", "csm1-response", "csm-1", "Customer response reliability", "primary", "Acknowledge customer questions quickly and set a clear next step even when the full answer needs more time.", "month", "95% of customer messages acknowledged within one business day."),
        ("skill", "csm1-product", "csm-1", "Product fluency", "primary", "Explain core forecasting workflows accurately and know when to bring in Product or Support.", "quarter", "Handles standard product questions independently and escalates with useful context."),
        ("skill", "csm1-followthrough", "csm-1", "Structured follow-through", "primary", "Turn conversations into explicit owners, dates, and visible next steps.", "month", "Closes the loop consistently without manager prompting."),
        ("metric", "csm2-grr", "csm-2", "Gross revenue retention", "primary", "Protect recurring revenue by identifying risk early and running credible recovery plans.", "quarter", "Maintain at least 92% gross revenue retention across the owned portfolio."),
        ("metric", "csm2-plans", "csm-2", "Current success-plan coverage", "secondary", "Keep a mutual success plan current for every strategic customer.", "month", "At least 90% of Tier 1 and Tier 2 accounts have a customer-confirmed success plan updated in the last 45 days."),
        ("metric", "csm2-risk", "csm-2", "Risk response time", "primary", "Convert credible risk signals into an owned response plan before they become renewal emergencies.", "month", "Acknowledge risk and publish an owner-backed recovery plan within two business days."),
        ("skill", "csm2-diagnosis", "csm-2", "Risk diagnosis", "primary", "Separate symptoms from causes and test the diagnosis with the customer and internal team.", "quarter", "Produces specific, evidence-backed risk statements and proportionate recovery plans."),
        ("skill", "csm2-exec", "csm-2", "Executive communication", "secondary", "Make decisions, risk, and value legible to senior customer stakeholders.", "quarter", "Leads concise executive conversations with a clear point of view and next step."),
        ("skill", "csm2-planning", "csm-2", "Mutual action planning", "primary", "Build plans customers actively own rather than internal task lists with their logo on top.", "quarter", "Plans name outcomes, owners, dates, dependencies, and customer confirmation."),
        ("skill", "csm2-commercial", "csm-2", "Commercial judgment", "secondary", "Balance customer advocacy with renewal, scope, and expansion realities.", "quarter", "Escalates commercial risk early and does not trade long-term trust for a quiet week."),
        ("metric", "csm3-nrr", "csm-3", "Strategic portfolio retention", "primary", "Protect and expand a complex portfolio while maintaining executive trust.", "quarter", "Maintain at least 105% net revenue retention across strategic accounts."),
        ("metric", "csm3-leverage", "csm-3", "Team leverage", "secondary", "Create reusable practices and coaching that improve outcomes beyond the owned portfolio.", "quarter", "Ship or teach at least one adopted team practice per quarter."),
        ("skill", "csm3-partnership", "csm-3", "Executive partnership", "primary", "Operate as a credible adviser to senior customer leaders through ambiguity and change.", "quarter", "Customers invite the CSM into planning decisions, not only escalations."),
        ("skill", "csm3-coaching", "csm-3", "Coaching and escalation leadership", "primary", "Help peers improve their judgment while keeping ownership with them.", "quarter", "Peers leave escalations with a clearer decision and greater future independence."),
    ]
    generic_expectations = [
        ("support-1", "Reliable resolution", "Resolve assigned issues accurately and communicate the next step before the customer has to ask."),
        ("support-2", "Incident leadership", "Create calm, ownership, and reusable learning during complex incidents."),
        ("ae-1", "Qualified pipeline", "Create honest, well-qualified opportunities with clear customer problems and next steps."),
        ("ae-2", "Forecast integrity", "Maintain a forecast the business can plan around and surface deal risk early."),
        ("marketing-2", "Qualified pipeline contribution", "Connect campaigns to qualified pipeline rather than activity volume."),
        ("pm-2", "Outcome-led discovery", "Translate customer and business problems into measurable product outcomes."),
        ("eng-2", "Dependable delivery", "Ship maintainable increments and surface delivery risk before it becomes a surprise."),
        ("eng-3", "Technical leverage", "Resolve ambiguous technical problems and improve the team's delivery system."),
    ]
    for role, name, description in generic_expectations:
        expectation_specs.extend(
            [
                ("metric", f"{role}-metric", role, name, "primary", description, "quarter", description),
                ("skill", f"{role}-skill", role, "Cross-functional clarity", "secondary", "Give partners the context, decision, and next step they need without jargon or surprise.", "quarter", "Partners can act without reconstructing the reasoning."),
            ]
        )

    metric_ids: dict[str, str] = {}
    skill_ids: dict[str, str] = {}
    for kind, key, role, name, order_type, description, period, expectation in expectation_specs:
        if kind == "metric":
            config_id = add(
                "metric_configs",
                f"metric:{key}",
                org_id=org_id,
                role_level_id=role_ids[role],
                metric_name=name,
                order_type=order_type,
                description=description,
                team=None,
                evaluation_scale_min=1,
                evaluation_scale_max=5,
                measurement_period=period,
                expectation=expectation,
                created_at=_ts(anchor, -300),
            )
            metric_ids[key] = config_id
            quantitative = None
            if key == "csm2-grr":
                quantitative = ["< 85%", "85–89%", "90–93%", "94–97%", "> 97%"]
            elif key == "csm2-plans":
                quantitative = ["< 60%", "60–74%", "75–89%", "90–97%", "> 97%"]
            elif key == "csm2-risk":
                quantitative = ["> 5 days", "3–5 days", "≤ 2 days", "Same day", "Anticipates before escalation"]
            rows["metric_scale_definitions"].extend(
                _scale_rows(key, config_id, "metric_config_id", quantitative=quantitative)
            )
        else:
            config_id = add(
                "skill_configs",
                f"skill:{key}",
                org_id=org_id,
                role_level_id=role_ids[role],
                skill_name=name,
                order_type=order_type,
                description=description,
                team=None,
                evaluation_scale_min=1,
                evaluation_scale_max=5,
                measurement_period=period,
                expectation=expectation,
                created_at=_ts(anchor, -300),
            )
            skill_ids[key] = config_id
            rows["skill_scale_definitions"].extend(
                _scale_rows(key, config_id, "skill_config_id")
            )

    value_specs = [
        ("own-outcome", "Own the outcome", "Take responsibility for the result, surface risk early, and close the loop even when the work crosses teams."),
        ("quiet-part", "Say the quiet part", "Name the constraint, disagreement, or risk the team needs to address—directly and respectfully."),
        ("make-useful", "Make it useful", "Prefer clear decisions and practical help over impressive-looking activity."),
    ]
    value_ids: dict[str, str] = {}
    for key, name, description in value_specs:
        value_ids[key] = add(
            "value_configs",
            f"value:{key}",
            org_id=org_id,
            role_level_id=None,
            value_name=name,
            order_type="primary",
            description=description,
            team=None,
            evaluation_scale_min=1,
            evaluation_scale_max=5,
            value_type="company",
            created_at=_ts(anchor, -300),
        )
        rows["value_scale_definitions"].extend(
            _scale_rows(key, value_ids[key], "value_config_id")
        )

    labels = ["Needs support", "Developing", "Solid", "Strong", "Exceptional"]
    for ordinal, label in enumerate(labels, start=1):
        add(
            "assessment_levels",
            f"assessment-level:{ordinal}",
            org_id=org_id,
            ordinal=ordinal,
            label=label,
        )

    overall = {
        "tessa": (4, 4, "Strong strategic judgment and growing leverage through peer coaching."),
        "lena": (3, 4, "Consistent portfolio ownership; executive communication has become a clear strength."),
        "mina": (3, 3, "Customer trust is strong. Follow-through on complex cross-functional work remains inconsistent."),
        "colin": (3, 2, "Customer conversations are credible, but commitments and account plans still require manager prompting."),
        "benji": (2, 3, "Learning quickly and beginning to own standard customer conversations independently."),
        "rae": (3, 4, "Runs disciplined onboarding plans and creates calm during high-change launches."),
        "devon": (4, 3, "Sound judgment and customer advocacy; current workload is reducing proactive account work."),
    }
    for key, (previous, current, note) in overall.items():
        add(
            "assessments",
            f"assessment:{key}:previous",
            manager_id=manager_ids["demo"],
            direct_report_id=report_ids[key],
            level_ordinal=previous,
            notes="Prior rolling snapshot.",
            source_type="manual",
            source_id=None,
            created_at=_ts(anchor, -56),
        )
        add(
            "assessments",
            f"assessment:{key}:current",
            manager_id=manager_ids["demo"],
            direct_report_id=report_ids[key],
            level_ordinal=current,
            notes=note,
            source_type="manual",
            source_id=None,
            created_at=_ts(anchor, -9),
        )

    csm2_metrics = {
        "lena": (95, 94, 1),
        "mina": (92, 78, 3),
        "colin": (88, 68, 4),
        "devon": (93, 86, 2),
    }
    for key, (grr, plans, risk_days) in csm2_metrics.items():
        for metric_key, value, period in [
            ("csm2-grr", grr, "2026-Q3"),
            ("csm2-plans", plans, anchor.strftime("%Y-%m")),
            ("csm2-risk", risk_days, anchor.strftime("%Y-%m")),
        ]:
            add(
                "metric_entries",
                f"metric-entry:{key}:{metric_key}",
                direct_report_id=report_ids[key],
                metric_config_id=metric_ids[metric_key],
                value=value,
                period=period,
                recorded_at=_ts(anchor, -8),
                recorded_by=manager_ids["demo"],
            )
    for key, value in {"tessa": 108, "benji": 92, "rae": 98}.items():
        metric_key = "csm3-nrr" if key == "tessa" else "csm1-response"
        add(
            "metric_entries",
            f"metric-entry:{key}:{metric_key}",
            direct_report_id=report_ids[key],
            metric_config_id=metric_ids[metric_key],
            value=value,
            period=anchor.strftime("%Y-%m"),
            recorded_at=_ts(anchor, -8),
            recorded_by=manager_ids["demo"],
        )

    skill_scores = {
        "tessa": [("csm3-partnership", 4, "Trusted by executive sponsors and increasingly deliberate about sharing the playbook."), ("csm3-coaching", 4, "Coaches with useful questions rather than taking over the account.")],
        "lena": [("csm2-exec", 4, "Executive updates are concise, candid, and decision-oriented."), ("csm2-planning", 4, "Plans consistently carry customer-owned milestones.")],
        "mina": [("csm2-diagnosis", 4, "Correctly isolated the inventory mapping issue from broader adoption noise."), ("csm2-planning", 2, "The recovery plan was sound but owners and dates were not kept current.")],
        "colin": [("csm2-exec", 3, "Customer conversations are clear when prepared."), ("csm2-planning", 2, "Next steps regularly live in notes instead of the shared plan.")],
        "benji": [("csm1-product", 3, "Handles standard Forecast Engine questions independently."), ("csm1-followthrough", 3, "Follow-up is reliable with a clear checklist.")],
        "rae": [("csm1-product", 4, "Strong implementation fluency across standard POS integrations."), ("csm1-followthrough", 4, "Owners and risks stay visible through launch.")],
        "devon": [("csm2-diagnosis", 4, "Finds the real customer constraint quickly."), ("csm2-commercial", 3, "Sound judgment, though workload is delaying proactive escalation.")],
    }
    for report_key, assessments in skill_scores.items():
        for skill_key, point, notes in assessments:
            add(
                "skill_assessments",
                f"skill-assessment:{report_key}:{skill_key}",
                direct_report_id=report_ids[report_key],
                skill_config_id=skill_ids[skill_key],
                evaluation_point=point,
                notes=notes,
                assessed_at=_ts(anchor, -9),
                assessed_by=manager_ids["demo"],
            )

    value_scores = {
        "tessa": [("own-outcome", 4), ("quiet-part", 4)],
        "lena": [("own-outcome", 4), ("make-useful", 4)],
        "mina": [("own-outcome", 2), ("quiet-part", 4)],
        "colin": [("own-outcome", 2), ("make-useful", 3)],
        "benji": [("own-outcome", 3), ("make-useful", 3)],
        "rae": [("own-outcome", 4), ("make-useful", 4)],
        "devon": [("own-outcome", 3), ("quiet-part", 4)],
    }
    for report_key, assessments in value_scores.items():
        for value_key, point in assessments:
            add(
                "value_assessments",
                f"value-assessment:{report_key}:{value_key}",
                direct_report_id=report_ids[report_key],
                value_config_id=value_ids[value_key],
                evaluation_point=point,
                notes=(
                    "Closes the loop reliably and keeps the shared outcome visible."
                    if point >= 4
                    else "The intent is clear; consistency is the current development edge."
                ),
                assessed_at=_ts(anchor, -9),
                assessed_by=manager_ids["demo"],
            )

    series_ids: dict[str, str] = {}
    next_offsets = {"tessa": 6, "lena": 4, "mina": 2, "colin": 1, "benji": 3, "rae": 7, "devon": 5}
    interval_weeks = {"benji": 1, **{key: 2 for key in ["tessa", "lena", "mina", "colin", "rae", "devon"]}}
    for key in next_offsets:
        series_ids[key] = add(
            "one_on_one_series",
            f"one-on-one-series:{key}",
            manager_id=manager_ids["demo"],
            direct_report_id=report_ids[key],
            interval_weeks=interval_weeks[key],
            anchor_at=_ts(anchor, next_offsets[key]),
            timezone="America/New_York",
            active=True,
            created_at=_ts(anchor, -120),
        )

    history_specs = {
        "tessa": [(-36, "Tessa stabilized the Northstar Hospitality renewal and coached Benji through his first executive QBR. She wants more opportunities to turn her escalation judgment into reusable team practices."), (-8, "Northstar renewed on plan. Tessa will lead a short peer clinic on executive QBR framing and continue coaching Benji without taking over his accounts.")],
        "lena": [(-31, "Lena reset expectations with Red Lantern after the POS integration slipped. Her direct executive update restored confidence and kept the pilot on track."), (-12, "Red Lantern accepted the revised pilot sequence. Lena's stakeholder map is strong; the next step is documenting the approach for the rest of the team.")],
        "mina": [(-30, "Copper Kettle trusts Mina's judgment, but the inventory mapping work is spread across Slack, notes, and an outdated launch plan. Mina agreed to consolidate owners and dates."), (-16, "The root cause is a location-level SKU mapping issue, not Forecast Engine accuracy. Mina rebuilt customer confidence but has not yet published the revised mapping or a fully owned recovery timeline.")],
        "colin": [(-39, "Colin's customer calls are thoughtful, but several follow-ups landed late and two success plans were stale. We agreed to use a same-day closeout checklist."), (-24, "The closeout checklist helped for one week, then three account updates slipped. Colin committed to publishing overdue success-plan notes and bringing a recovery rhythm to the next 1:1.")],
        "benji": [(-15, "Benji ran the Night Owl Noodles check-in with minimal support and correctly escalated a data-quality question instead of guessing."), (-6, "Benji is ready to own five standard customer check-ins independently. Tessa will review his first executive QBR outline before it goes out.")],
        "rae": [(-27, "Rae brought the Sidecar Tacos onboarding back to green by reducing the launch scope and naming a single customer owner."), (-10, "The revised onboarding template is working. Rae will document the risk triage section so the rest of the team can reuse it.")],
        "devon": [(-34, "Devon has become the default escalation partner for three teammates. Customer outcomes remain solid, but proactive portfolio work is compressing."), (-11, "Devon wants to keep mentoring, but not as an invisible second job. Jamie will rebalance two launch accounts and make the escalation rotation explicit.")],
    }
    one_on_one_ids: dict[str, list[str]] = defaultdict(list)
    for report_key, history in history_specs.items():
        for index, (offset, summary) in enumerate(history, start=1):
            meeting_id = add(
                "one_on_ones",
                f"one-on-one:{report_key}:history:{index}",
                org_id=org_id,
                manager_id=manager_ids["demo"],
                direct_report_id=report_ids[report_key],
                series_id=series_ids[report_key],
                scheduled_at=_ts(anchor, offset),
                summary=summary,
                notes=None,
                prep_guide=None,
                carry_forward_items=[],
                created_at=_ts(anchor, offset),
            )
            one_on_one_ids[report_key].append(meeting_id)

    commitment_ids = {
        "mina-mapping": seed_id("commitment:mina:mapping"),
        "jamie-workaround": seed_id("commitment:jamie:workaround"),
        "colin-plans": seed_id("commitment:colin:plans"),
        "tessa-qbr": seed_id("commitment:tessa:qbr"),
        "retro-agenda": seed_id("commitment:jamie:retro-agenda"),
    }
    prep_guide = {
        "situation_summary": "Mina has rebuilt trust with Copper Kettle and correctly diagnosed the inventory-mapping issue, but the revised mapping is overdue and the rollout remains at risk. Use this conversation to separate customer complexity from follow-through, agree on a recovery rhythm, and protect the strong customer relationship she has created.",
        "agenda_items": [
            {
                "title": "Close the open loops",
                "rationale": "Two time-sensitive commitments are still open and the rollout cannot move cleanly without them.",
                "suggested_questions": [
                    "What is preventing the revised mapping from going out today?",
                    "Which decision do you need from me before the next customer update?",
                ],
            },
            {
                "title": "Copper Kettle recovery",
                "rationale": "The diagnosis is credible; the current risk is execution visibility and customer-owned dates.",
                "suggested_questions": [
                    "What would make the recovery plan believable to the customer?",
                    "Which milestone is most likely to slip next, and how will we know early?",
                ],
            },
            {
                "title": "Make follow-through visible",
                "rationale": "This is the clearest gap between Mina's strong customer judgment and the Senior CSM bar.",
                "suggested_questions": [
                    "What system would make owners and dates visible without adding busywork?",
                    "Where does your current process break when work crosses Product and Support?",
                ],
            },
            {
                "title": "Path to Senior CSM",
                "rationale": "Mina's risk diagnosis is already strong; reliable mutual action planning is the next development edge.",
                "suggested_questions": [
                    "What part of the Senior CSM role do you want to practice in this recovery?",
                    "Whose approach to complex action plans would be useful to observe?",
                ],
            },
            {
                "title": "Anything else?",
                "rationale": "Leave space for context or support that the structured agenda did not surface.",
                "suggested_questions": ["What's one thing I could do to make your work easier this week?"],
            },
        ],
        "open_commitments_to_check": [
            {
                "id": commitment_ids["mina-mapping"],
                "description": "Send the revised inventory mapping to Copper Kettle.",
                "due_date": _date(anchor, 1),
                "committed_by": "direct_report",
            },
            {
                "id": commitment_ids["jamie-workaround"],
                "description": "Get Product's decision on the offline-sync workaround.",
                "due_date": _date(anchor, 2),
                "committed_by": "manager",
            },
        ],
        "source_notes": "Mina has the customer's trust. I need to be direct that strong diagnosis is not enough if the shared plan stays stale. Ask what support would make the recovery rhythm sustainable.",
    }
    upcoming_ids: dict[str, str] = {}
    carry_forwards = {
        "tessa": ["Turn the Northstar escalation approach into a peer coaching example."],
        "lena": ["Share the Red Lantern stakeholder update template."],
        "mina": ["Make the Copper Kettle recovery plan customer-owned, not just internally complete."],
        "colin": ["Review whether the same-day closeout checklist is actually being used."],
        "benji": ["Debrief the first independently run customer check-in."],
        "rae": ["Review the reusable onboarding risk-triage section."],
        "devon": ["Confirm which launch accounts move off Devon's portfolio."],
    }
    for key, offset in next_offsets.items():
        upcoming_ids[key] = add(
            "one_on_ones",
            f"one-on-one:{key}:upcoming",
            org_id=org_id,
            manager_id=manager_ids["demo"],
            direct_report_id=report_ids[key],
            series_id=series_ids[key],
            scheduled_at=_ts(anchor, offset),
            summary=None,
            notes=None,
            prep_guide=prep_guide if key == "mina" else None,
            carry_forward_items=carry_forwards[key],
            created_at=_ts(anchor, -2),
        )

    commitment_specs = [
        ("mina:mapping", commitment_ids["mina-mapping"], "Send the revised inventory mapping to Copper Kettle.", "mina", "direct_report", 1, "open", False, "one_on_one", one_on_one_ids["mina"][-1], -16),
        ("jamie:workaround", commitment_ids["jamie-workaround"], "Get Product's decision on the offline-sync workaround.", "mina", "manager", 2, "open", False, "one_on_one", one_on_one_ids["mina"][-1], -16),
        ("colin:plans", commitment_ids["colin-plans"], "Publish follow-up notes for three overdue success plans.", "colin", "direct_report", -2, "open", True, "one_on_one", one_on_one_ids["colin"][-1], -24),
        ("tessa:qbr", commitment_ids["tessa-qbr"], "Review Benji's first executive QBR outline.", "tessa", "direct_report", 5, "open", True, "one_on_one", one_on_one_ids["tessa"][-1], -8),
        ("jamie:retro", commitment_ids["retro-agenda"], "Confirm the Forecast Engine v3 retrospective agenda.", None, "manager", 3, "open", True, "manual", None, -3),
        ("lena:stakeholder-map", seed_id("commitment:lena:stakeholder-map"), "Send the revised stakeholder map to Red Lantern.", "lena", "direct_report", -7, "done", False, "one_on_one", one_on_one_ids["lena"][-1], -12),
        ("rae:risk-template", seed_id("commitment:rae:risk-template"), "Draft the onboarding risk-triage template.", "rae", "direct_report", -1, "done", True, "one_on_one", one_on_one_ids["rae"][-1], -10),
        ("devon:rebalance", seed_id("commitment:devon:rebalance"), "Propose two launch accounts to rebalance from Devon's portfolio.", "devon", "manager", 6, "open", False, "one_on_one", one_on_one_ids["devon"][-1], -11),
        ("benji:qbr", seed_id("commitment:benji:qbr"), "Draft the Night Owl Noodles executive QBR outline.", "benji", "direct_report", 4, "open", False, "one_on_one", one_on_one_ids["benji"][-1], -6),
    ]
    for label, row_id, description, report_key, committed_by, due, status, team, source_type, source_id, created in commitment_specs:
        rows["commitments"].append(
            {
                "id": row_id,
                "org_id": org_id,
                "title": None,
                "description": description,
                "owner_id": manager_ids["demo"],
                "direct_report_id": report_ids[report_key] if report_key else None,
                "committed_by": committed_by,
                "source_type": source_type,
                "source_id": source_id,
                "due_date": _date(anchor, due),
                "status": status,
                "completed_at": _ts(anchor, due) if status == "done" else None,
                "is_team_commitment": team,
                "created_at": _ts(anchor, created),
            }
        )

    add(
        "dr_capture_notes",
        "capture:colin:renewal-followup",
        manager_id=manager_ids["demo"],
        direct_report_id=report_ids["colin"],
        content="Colin gave a thoughtful renewal recommendation in the team meeting, then the promised follow-up still did not land. Ask what changes between the conversation and the closeout.",
        created_at=_ts(anchor, -2),
    )
    add(
        "dr_capture_notes",
        "capture:devon:capacity",
        manager_id=manager_ids["demo"],
        direct_report_id=report_ids["devon"],
        content="Devon volunteered to help with another escalation. Appreciate the instinct, but protect the portfolio rebalance we already agreed to.",
        created_at=_ts(anchor, -1),
    )

    goal_specs = [
        ("company-arr", "Reach $12M ARR without setting Support on fire", "Grow responsibly: protect retention and customer experience while closing the year at the next revenue milestone.", "$12M ARR; gross revenue retention at or above 92%; median first response below four hours.", "company", None, None, None, "on_track", 128, -150),
        ("cs-retention", "Lift gross revenue retention to 93%", "Reduce preventable churn by making risk diagnosis and recovery ownership consistent across the CS team.", "Quarterly GRR at or above 93%; every red account has a customer-confirmed recovery plan within two business days.", "team", "customer-success", None, "company-arr", "at_risk", 67, -120),
        ("cs-onboarding", "Make every enterprise launch boring", "Standardize the launch path so complex restaurant groups reach first value without heroics.", "Median enterprise time to first value below 45 days; 90% of launches use the shared risk plan.", "team", "customer-success", None, "company-arr", "on_track", 82, -100),
        ("support-response", "Bring first response below four hours", "Restore queue health after Forecast Engine v3 without trading speed for low-quality closes.", "Median first response below four hours and reopen rate below 8%.", "team", "support", None, "company-arr", "at_risk", 36, -80),
        ("sales-arr", "Close $1.8M in right-fit new ARR", "Grow new ARR without selling integrations or workflows the post-sale teams cannot support.", "$1.8M closed-won; implementation exception rate below 10%.", "team", "sales", None, "company-arr", "active", 97, -95),
        ("marketing-campaign", "Make '86 the Guesswork' pipeline-positive", "Turn the new category campaign into qualified restaurant-operations pipeline.", "Generate $600k qualified pipeline at a blended cost per opportunity below $1,800.", "team", "marketing", None, "company-arr", "on_track", 51, -70),
        ("mina-copper", "Stabilize the Copper Kettle rollout", "Restore a customer-owned launch plan and complete the inventory mapping across all 42 locations.", "Customer confirms revised milestones; mapping validation completes; go-live risk returns to green.", "individual", None, "mina", "cs-retention", "at_risk", 10, -45),
        ("colin-followthrough", "Restore reliable follow-through across Tier 1 accounts", "Build a closeout rhythm that keeps success plans and customer commitments current without manager prompting.", "95% of Tier 1 next steps updated within one business day for six consecutive weeks.", "individual", None, "colin", "cs-retention", "at_risk", 31, -60),
        ("tessa-coaching", "Coach two CSMs through executive QBRs", "Turn Tessa's executive judgment into reusable leverage for Benji and Mina.", "Two observed QBRs, two debriefs, and one reusable framing guide adopted by the team.", "individual", None, "tessa", "cs-onboarding", "on_track", 45, -55),
        ("benji-checkins", "Own five customer check-ins independently", "Build confidence and judgment across standard customer conversations.", "Five check-ins run independently with accurate follow-up and no avoidable rework.", "individual", None, "benji", "cs-onboarding", "active", 28, -20),
    ]
    goal_ids: dict[str, str] = {key: seed_id(f"goal:{key}") for key, *_ in goal_specs}
    for key, title, description, success, level, unit, report, parent, status, due, created in goal_specs:
        rows["goals"].append(
            {
                "id": goal_ids[key],
                "org_id": org_id,
                "title": title,
                "description": description,
                "success_metrics": success,
                "level": level,
                "org_unit_id": unit_ids[unit] if unit else None,
                "owner_id": manager_ids["demo"],
                "direct_report_id": report_ids[report] if report else None,
                "parent_goal_id": goal_ids[parent] if parent else None,
                "status": status,
                "due_date": _date(anchor, due),
                "created_at": _ts(anchor, created),
            }
        )

    project_specs = [
        ("copper-recovery", "Copper Kettle rollout recovery", "Rebuild the 42-location inventory mapping, confirm POS exceptions, and publish a customer-owned path to go-live.", "mina-copper", "mina", "customer-success", "at_risk", 5, -38),
        ("onboarding-playbook", "Enterprise onboarding playbook", "Turn the launch sequence, risk triage, and stakeholder checkpoints into one reusable operating playbook.", "cs-onboarding", "tessa", "customer-success", "on_track", 26, -62),
        ("red-lantern-pilot", "Red Lantern POS integration pilot", "Validate the revised integration sequence with six pilot locations before broad rollout.", "cs-onboarding", "lena", "customer-success", "on_track", 18, -42),
        ("risk-rhythm", "Tier 1 risk-review rhythm", "Create a weekly review that converts risk signals into owned recovery plans and visible follow-through.", "colin-followthrough", "colin", "customer-success", "at_risk", 12, -33),
        ("qbr-clinic", "Executive QBR peer clinic", "Run two live working sessions and publish a concise framing guide for the team.", "tessa-coaching", "tessa", "customer-success", "on_track", 21, -28),
        ("campaign", "86 the Guesswork launch", "Launch the restaurant-operations campaign across content, paid social, and the fall event sequence.", "marketing-campaign", None, "marketing", "on_track", 17, -48),
        ("v3-retro", "Forecast Engine v3 retrospective", "Separate launch defects, enablement gaps, and expectation failures so the next release is quieter for customers and Support.", "support-response", None, "support", "active", 14, -12),
    ]
    project_ids: dict[str, str] = {key: seed_id(f"project:{key}") for key, *_ in project_specs}
    for key, title, description, goal, report, unit, status, due, created in project_specs:
        rows["projects"].append(
            {
                "id": project_ids[key],
                "org_id": org_id,
                "title": title,
                "description": description,
                "goal_id": goal_ids[goal],
                "direct_report_id": report_ids[report] if report else None,
                "org_unit_id": unit_ids[unit],
                "owner_id": manager_ids["demo"],
                "status": status,
                "due_date": _date(anchor, due),
                "created_at": _ts(anchor, created),
            }
        )

    check_in_specs = [
        ("goal", "cs-retention", -29, "at_risk", 48, "Two preventable risk escalations exposed inconsistent recovery ownership."),
        ("goal", "cs-retention", -8, "at_risk", 62, "GRR is improving, but Copper Kettle and two stale success plans keep the target at risk."),
        ("goal", "cs-onboarding", -24, "on_track", 42, "Rae's revised launch template is now in use on three accounts."),
        ("goal", "cs-onboarding", -3, "on_track", 71, "Pilot launches are using the shared risk plan; enterprise timing is trending down."),
        ("goal", "marketing-campaign", -19, "active", 25, "Message testing complete; pipeline impact not yet measurable."),
        ("goal", "marketing-campaign", -4, "on_track", 56, "First event and paid-social cohorts are producing qualified restaurant-operations conversations."),
        ("goal", "mina-copper", -26, "at_risk", 25, "Root cause identified; revised mapping and customer-owned dates still missing."),
        ("goal", "mina-copper", -18, "at_risk", 45, "Customer confidence recovered, but execution plan is stale."),
        ("goal", "colin-followthrough", -30, "active", 20, "Same-day closeout checklist introduced."),
        ("goal", "colin-followthrough", -15, "at_risk", 35, "Initial improvement did not hold; three account updates are overdue."),
        ("goal", "tessa-coaching", -6, "on_track", 50, "First QBR coaching session complete; Benji's outline is ready for review."),
        ("goal", "benji-checkins", -5, "on_track", 40, "Two of five check-ins completed independently with accurate follow-up."),
        ("project", "copper-recovery", -28, "active", 20, "Mapping workstream opened across Product, Support, and the customer team."),
        ("project", "copper-recovery", -18, "at_risk", 58, "Diagnosis is confirmed; revised mapping and owned customer timeline remain outstanding."),
        ("project", "onboarding-playbook", -17, "on_track", 45, "Core launch sequence documented and reviewed with Rae."),
        ("project", "onboarding-playbook", -3, "on_track", 72, "Risk triage and stakeholder checkpoints added; peer review remains."),
        ("project", "red-lantern-pilot", -14, "active", 30, "Six pilot locations selected and data prerequisites confirmed."),
        ("project", "red-lantern-pilot", -2, "on_track", 65, "Four locations validated; two await weekend transaction data."),
        ("project", "risk-rhythm", -20, "active", 20, "Weekly review drafted and first account set selected."),
        ("project", "risk-rhythm", -15, "at_risk", 35, "The meeting occurred, but account updates were not consistently closed out."),
        ("project", "qbr-clinic", -6, "on_track", 40, "First working session complete; framing guide outline captured."),
        ("project", "campaign", -4, "on_track", 55, "Launch assets live; early pipeline quality is above the prior benchmark."),
        ("project", "v3-retro", -2, "active", 15, "Incident themes collected; cross-functional retrospective still needs a final agenda."),
    ]
    for index, (parent_type, parent_key, offset, status, progress, note) in enumerate(check_in_specs):
        add(
            "check_ins",
            f"check-in:{parent_type}:{parent_key}:{index}",
            owner_id=manager_ids["demo"],
            goal_id=goal_ids[parent_key] if parent_type == "goal" else None,
            project_id=project_ids[parent_key] if parent_type == "project" else None,
            status=status,
            progress=progress,
            note=note,
            created_at=_ts(anchor, offset),
        )

    meeting_series_id = add(
        "team_meeting_series",
        "team-meeting-series:cs-weekly",
        manager_id=manager_ids["demo"],
        org_unit_id=unit_ids["customer-success"],
        interval_weeks=1,
        anchor_at=_ts(anchor, 3),
        timezone="America/New_York",
        active=True,
        created_at=_ts(anchor, -100),
    )
    prior_meeting_id = add(
        "team_meetings",
        "team-meeting:cs:prior",
        manager_id=manager_ids["demo"],
        agenda_note=None,
        summary="The team separated Forecast Engine v3 product defects from enablement gaps and agreed not to call every confused customer a model-quality issue. Tessa will coach Benji's first executive QBR, and Colin will close the stale success-plan follow-ups before the next team sync.",
        raw_notes="v3 issues: two actual defects, several setup gaps. Copper Kettle mapping is account-specific. Tessa to coach Benji. Colin to close stale notes. Carry retro agenda.",
        scheduled_at=_ts(anchor, -4),
        series_id=meeting_series_id,
        logged_at=_ts(anchor, -4, 16),
        org_unit_id=unit_ids["customer-success"],
        created_at=_ts(anchor, -11),
    )
    upcoming_meeting_id = add(
        "team_meetings",
        "team-meeting:cs:upcoming",
        manager_id=manager_ids["demo"],
        agenda_note=None,
        summary=None,
        raw_notes=None,
        scheduled_at=_ts(anchor, 3),
        series_id=meeting_series_id,
        logged_at=None,
        org_unit_id=unit_ids["customer-success"],
        created_at=_ts(anchor, -4),
    )
    prior_agenda = [
        ("v3-signals", "Forecast Engine v3: defects vs. enablement", True, "Two confirmed defects; most confusion came from setup and expectation gaps."),
        ("portfolio-risk", "Portfolio risk review", True, "Copper Kettle remains at risk. Three Colin-owned success plans are stale."),
        ("retro", "Confirm the v3 retrospective agenda", False, "Needs Product and Support input before finalizing."),
    ]
    prior_item_ids: dict[str, str] = {}
    for position, (key, item, covered, notes) in enumerate(prior_agenda):
        prior_item_ids[key] = add(
            "team_meeting_agenda_items",
            f"team-agenda:prior:{key}",
            meeting_id=prior_meeting_id,
            manager_id=manager_ids["demo"],
            position=position,
            item=item,
            covered=covered,
            notes=notes,
            carried_from_item_id=None,
            created_at=_ts(anchor, -11),
        )
    upcoming_agenda = [
        ("copper", "Copper Kettle recovery: owners and customer dates", None),
        ("retro", "Confirm the Forecast Engine v3 retrospective agenda", prior_item_ids["retro"]),
        ("qbr", "Benji's first executive QBR", None),
        ("capacity", "Portfolio rebalance before fall launches", None),
    ]
    for position, (key, item, carried_from) in enumerate(upcoming_agenda):
        add(
            "team_meeting_agenda_items",
            f"team-agenda:upcoming:{key}",
            meeting_id=upcoming_meeting_id,
            manager_id=manager_ids["demo"],
            position=position,
            item=item,
            covered=False,
            notes=None,
            carried_from_item_id=carried_from,
            created_at=_ts(anchor, -4),
        )

    add(
        "team_callouts",
        "team-callout:cs",
        manager_id=manager_ids["demo"],
        message="Copper Kettle recovery stays red until the customer confirms owners and dates.\nForecast Engine v3 retro is Friday—separate product defects from enablement gaps.\nBenji owns his first executive QBR next week; Tessa is coaching, not ghostwriting.",
        org_unit_id=unit_ids["customer-success"],
        updated_at=_ts(anchor, -1),
    )
    add(
        "team_dev_focus",
        "team-dev-focus:cs",
        manager_id=manager_ids["demo"],
        message="Make follow-through legible: every risk leaves the conversation with an owner, a date, and a customer-confirmed next step.",
        org_unit_id=unit_ids["customer-success"],
        updated_at=_ts(anchor, -6),
    )

    for key in ["tessa", "lena", "mina", "colin", "benji", "rae", "devon"]:
        add(
            "team_messages",
            f"team-message:{key}",
            manager_id=manager_ids["demo"],
            direct_report_id=report_ids[key],
            message={
                "tessa": "This week: coach Benji's QBR framing and protect your own Northstar follow-through.",
                "lena": "This week: finish the Red Lantern pilot validation and share the stakeholder-update template.",
                "mina": "This week: publish the Copper Kettle mapping and customer-owned recovery dates.",
                "colin": "This week: close the three stale success plans before taking on new process work.",
                "benji": "This week: run the Night Owl check-in and bring your first QBR outline to Tessa.",
                "rae": "This week: finish the onboarding risk-triage section for team review.",
                "devon": "This week: name the two accounts to rebalance and stop accepting new escalation work by default.",
            }[key],
            created_at=_ts(anchor, -2),
        )

    add(
        "capacity_settings",
        "capacity-settings:forkcast",
        org_id=org_id,
        default_hours_per_week=40,
        default_target_utilization_pct=75,
        default_off_days_per_year=21,
        created_at=_ts(anchor, -300),
        updated_at=_ts(anchor, -20),
    )
    add(
        "capacity_profiles",
        "capacity-profile:devon",
        direct_report_id=report_ids["devon"],
        contracted_hours_per_week=40,
        target_utilization_pct=65,
        off_days_per_year=21,
        created_at=_ts(anchor, -120),
        updated_at=_ts(anchor, -11),
    )
    add(
        "capacity_profiles",
        "capacity-profile:rae",
        direct_report_id=report_ids["rae"],
        contracted_hours_per_week=32,
        target_utilization_pct=75,
        off_days_per_year=18,
        created_at=_ts(anchor, -180),
        updated_at=_ts(anchor, -20),
    )
    add(
        "time_off_entries",
        "time-off:lena:pto",
        direct_report_id=report_ids["lena"],
        start_date=_date(anchor, 6),
        end_date=_date(anchor, 7),
        type="pto",
        hours_per_day=None,
        notes="Planned time off",
        created_at=_ts(anchor, -20),
    )
    add(
        "time_off_entries",
        "time-off:devon:appointment",
        direct_report_id=report_ids["devon"],
        start_date=_date(anchor, 2),
        end_date=_date(anchor, 2),
        type="other",
        hours_per_day=4,
        notes="Half day",
        created_at=_ts(anchor, -8),
    )
    for role_key, unit_name, hours_per_unit in [
        ("csm-1", "customer-facing hour", 1),
        ("csm-2", "customer-facing hour", 1),
        ("csm-3", "customer-facing hour", 1),
    ]:
        add(
            "work_unit_configs",
            f"work-unit:{role_key}",
            org_id=org_id,
            role_level_id=role_ids[role_key],
            unit_name=unit_name,
            hours_per_unit=hours_per_unit,
            created_at=_ts(anchor, -200),
        )

    plan_specs = {
        "mina": ("Build the operating discipline expected of a Senior CSM without losing the customer empathy and diagnostic judgment that already make Mina effective. The current focus is turning complex cross-functional work into customer-owned plans with visible owners, dates, and escalation points.", "Senior Customer Success Manager", "6–9 months", "Use the Copper Kettle recovery as a live proving ground, then lead a peer session on mutual action planning."),
        "colin": ("Rebuild trust in follow-through by using one closeout system consistently for six weeks. The goal is not more documentation; it is making every customer and internal commitment visible before another person has to chase it.", "Consistent Customer Success Manager II performance", "Next 90 days", "Stabilize current-role execution before expanding scope."),
        "benji": ("Grow from supported execution to independent ownership of standard customer conversations. Practice accurate preparation, direct questions, and same-day follow-up, with Tessa coaching on executive framing.", "Customer Success Manager II", "9–12 months", "Demonstrate repeatable ownership across five check-ins and two QBRs."),
    }
    plan_ids: dict[str, str] = {}
    for key, (plan_text, desired_role, timeline, notes) in plan_specs.items():
        plan_ids[key] = add(
            "development_plans",
            f"development-plan:{key}",
            direct_report_id=report_ids[key],
            manager_id=manager_ids["demo"],
            status="active",
            plan_text=plan_text,
            created_at=_ts(anchor, -50),
            updated_at=_ts(anchor, -7),
        )
        add(
            "dev_plan_aspirations",
            f"development-aspiration:{key}",
            development_plan_id=plan_ids[key],
            desired_role=desired_role,
            timeline=timeline,
            notes=notes,
            updated_at=_ts(anchor, -7),
        )
    add(
        "dev_plan_opportunities",
        "development-opportunity:mina:planning",
        development_plan_id=plan_ids["mina"],
        type="skill",
        description="Turn complex recovery work into a mutual action plan customers actively own.",
        source_kind="skill",
        source_config_id=skill_ids["csm2-planning"],
        created_at=_ts(anchor, -9),
    )
    add(
        "dev_plan_opportunities",
        "development-opportunity:colin:followthrough",
        development_plan_id=plan_ids["colin"],
        type="skill",
        description="Use one same-day closeout rhythm until reliable follow-through no longer depends on manager prompting.",
        source_kind="value",
        source_config_id=value_ids["own-outcome"],
        created_at=_ts(anchor, -9),
    )
    add(
        "dev_plan_opportunities",
        "development-opportunity:benji:executive",
        development_plan_id=plan_ids["benji"],
        type="skill",
        description="Practice concise executive framing through observed QBR preparation and debriefs.",
        source_kind="skill",
        source_config_id=skill_ids["csm1-followthrough"],
        created_at=_ts(anchor, -9),
    )
    add(
        "dev_plan_training",
        "development-training:mina:planning",
        development_plan_id=plan_ids["mina"],
        description="Shadow Tessa's Northstar executive planning session and debrief the action-plan structure afterward.",
        completion_date=_date(anchor, 24),
        projected_cost=0,
        created_at=_ts(anchor, -7),
    )
    add(
        "dev_plan_training",
        "development-training:benji:qbr",
        development_plan_id=plan_ids["benji"],
        description="Complete the internal executive QBR clinic and run two coached practice sessions.",
        completion_date=_date(anchor, 35),
        projected_cost=0,
        created_at=_ts(anchor, -7),
    )
    add(
        "dev_plan_manager_notes",
        "development-note:mina",
        development_plan_id=plan_ids["mina"],
        content="Do not let the missed mapping obscure the strength of Mina's diagnosis and customer repair. Hold the execution bar clearly while naming the capability already present.",
        created_at=_ts(anchor, -8),
    )
    add(
        "dev_plan_manager_notes",
        "development-note:colin",
        development_plan_id=plan_ids["colin"],
        content="Keep feedback behavioral and specific: the issue is not effort or care, it is that other people cannot reliably see whether the promised follow-up happened.",
        created_at=_ts(anchor, -8),
    )

    return dict(rows)


def validate_demo_data(rows: dict[str, list[dict[str, Any]]]) -> list[str]:
    """Return validation errors without requiring Supabase."""

    errors: list[str] = []
    ids: dict[str, str] = {}
    for table, table_rows in rows.items():
        for row in table_rows:
            row_id = row.get("id")
            if not row_id:
                errors.append(f"{table} row is missing id")
                continue
            try:
                UUID(str(row_id))
            except ValueError:
                errors.append(f"{table}.{row_id} is not a UUID")
            if row_id in ids:
                errors.append(f"duplicate id {row_id} in {ids[row_id]} and {table}")
            ids[row_id] = table

    expected_counts = {
        "organizations": 1,
        "users": 5,
        "org_units": 8,
        "direct_reports": 23,
        "assessment_levels": 5,
        "one_on_one_series": 7,
        "team_meeting_series": 1,
        "team_meetings": 2,
    }
    for table, expected in expected_counts.items():
        actual = len(rows.get(table, []))
        if actual != expected:
            errors.append(f"{table} expected {expected} rows, found {actual}")

    report_ids = {row["id"] for row in rows.get("direct_reports", [])}
    role_ids = {row["id"] for row in rows.get("role_levels", [])}
    unit_ids = {row["id"] for row in rows.get("org_units", [])}
    goal_ids = {row["id"] for row in rows.get("goals", [])}
    project_ids = {row["id"] for row in rows.get("projects", [])}
    for row in rows.get("direct_reports", []):
        if row["role_level_id"] not in role_ids:
            errors.append(f"direct_reports.{row['id']} has unknown role_level_id")
        if row["org_unit_id"] not in unit_ids:
            errors.append(f"direct_reports.{row['id']} has unknown org_unit_id")
        if not row["email"].endswith("@forkcast.example"):
            errors.append(f"direct_reports.{row['id']} does not use the fictional email domain")
    for row in rows.get("check_ins", []):
        parents = int(row.get("goal_id") is not None) + int(row.get("project_id") is not None)
        if parents != 1:
            errors.append(f"check_ins.{row['id']} must have exactly one parent")
        if row.get("goal_id") and row["goal_id"] not in goal_ids:
            errors.append(f"check_ins.{row['id']} has unknown goal_id")
        if row.get("project_id") and row["project_id"] not in project_ids:
            errors.append(f"check_ins.{row['id']} has unknown project_id")
    for row in rows.get("one_on_ones", []):
        if row["direct_report_id"] not in report_ids:
            errors.append(f"one_on_ones.{row['id']} has unknown direct_report_id")
        if not isinstance(row.get("carry_forward_items"), list):
            errors.append(f"one_on_ones.{row['id']} carry_forward_items is not a list")
        guide = row.get("prep_guide")
        if guide:
            items = guide.get("agenda_items") or []
            if not items or items[-1].get("title") != "Anything else?":
                errors.append(f"one_on_ones.{row['id']} prep guide does not end with the closing question")

    unfinished_by_report: defaultdict[str, int] = defaultdict(int)
    for row in rows.get("one_on_ones", []):
        if row.get("summary") is None:
            unfinished_by_report[row["direct_report_id"]] += 1
    demo_reports = [
        row for row in rows.get("direct_reports", []) if row["name"] in {
            "Tessa Rowan", "Lena Morales", "Mina Okafor", "Colin Avery",
            "Benji Park", "Rae Holloway", "Devon Price",
        }
    ]
    for row in demo_reports:
        if unfinished_by_report[row["id"]] != 1:
            errors.append(f"{row['name']} must have exactly one unfinished 1:1")

    current_assessments: dict[str, int] = {}
    for row in sorted(rows.get("assessments", []), key=lambda item: item["created_at"]):
        current_assessments[row["direct_report_id"]] = row["level_ordinal"]
    if not ({2, 3, 4} <= set(current_assessments.values())):
        errors.append("assessment distribution must include below-bar, solid, and strong people")

    if rows.get("mission_control_events"):
        errors.append("mission_control_events must start empty so no seeded disposition hides a candidate")

    return errors


def summarize_demo_data(rows: dict[str, list[dict[str, Any]]]) -> str:
    total = sum(len(table_rows) for table_rows in rows.values())
    table_lines = [f"  {table}: {len(rows[table])}" for table in sorted(rows)]
    return "\n".join([f"Forkcast demo: {total} rows across {len(rows)} tables", *table_lines])
