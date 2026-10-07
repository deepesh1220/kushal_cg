INSERT INTO mst_holiday (
    holiday_date,
    month_name,
    year,
    holiday_name,
    weekday_name
)
VALUES
    ('2026-01-03', 'January', 2026, 'Maa Shakambhari Jayanti / Chherchhera', 'Saturday'),
    ('2026-01-26', 'January', 2026, 'Republic Day', 'Monday'),

    ('2026-02-15', 'February', 2026, 'Mahashivratri', 'Sunday'),

    ('2026-03-04', 'March', 2026, 'Holi', 'Wednesday'),
    ('2026-03-15', 'March', 2026, 'Bhakt Mata Karma Jayanti', 'Sunday'),
    ('2026-03-21', 'March', 2026, 'Eid-ul-Fitr', 'Saturday'),
    ('2026-03-26', 'March', 2026, 'Ram Navami', 'Thursday'),
    ('2026-03-31', 'March', 2026, 'Mahavir Jayanti', 'Tuesday'),

    ('2026-04-03', 'April', 2026, 'Good Friday', 'Friday'),
    ('2026-04-14', 'April', 2026, 'Dr. Ambedkar Jayanti', 'Tuesday'),

    ('2026-05-01', 'May', 2026, 'Buddha Purnima', 'Friday'),
    ('2026-05-27', 'May', 2026, 'Eid-ul-Zuha (Bakrid)', 'Wednesday'),

    ('2026-06-26', 'June', 2026, 'Muharram', 'Friday'),
    ('2026-06-29', 'June', 2026, 'Kabir Jayanti', 'Monday'),

    ('2026-08-09', 'August', 2026, 'World Tribal Day', 'Sunday'),
    ('2026-08-12', 'August', 2026, 'Hareli', 'Wednesday'),
    ('2026-08-15', 'August', 2026, 'Independence Day', 'Saturday'),
    ('2026-08-26', 'August', 2026, 'Eid-e-Milad (Milad-un-Nabi)', 'Wednesday'),
    ('2026-08-28', 'August', 2026, 'Raksha Bandhan', 'Friday'),

    ('2026-09-04', 'September', 2026, 'Krishna Janmashtami', 'Friday'),
    ('2026-09-14', 'September', 2026, 'Hartalika Teej', 'Monday'),

    ('2026-10-02', 'October', 2026, 'Gandhi Jayanti', 'Friday'),
    ('2026-10-20', 'October', 2026, 'Dussehra (Vijayadashami)', 'Tuesday'),

    ('2026-11-08', 'November', 2026, 'Diwali (Deepavali)', 'Sunday'),
    ('2026-11-15', 'November', 2026, 'Chhath Puja', 'Sunday'),
    ('2026-11-24', 'November', 2026, 'Guru Nanak Jayanti', 'Tuesday'),

    ('2026-12-18', 'December', 2026, 'Guru Ghasidas Jayanti', 'Friday'),
    ('2026-12-25', 'December', 2026, 'Christmas Day', 'Friday')

ON CONFLICT (holiday_date, holiday_name) DO NOTHING;