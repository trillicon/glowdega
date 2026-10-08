"""The /resources/ hub and calculator pages (Beauty Business Calculator Suite). Imported by tools/build.py, which passes
its page() template so the pages share the site header, footer and versioned stylesheet.

Each calculator page is static HTML (crawlable: title, description, H1, intro, JSON-LD, labelled inputs) plus one ES
module from assets/calc/calculators/. Formulas live only in assets/calc/core/; the pages and UI scripts hold none.
"""
import hashlib, html, json, os

ORIGIN = 'https://www.glowdega.com'
BRAND = 'GLOWDEGA'
COACHING = 'mailto:book@fairyglowmother.com?subject=' + 'Beauty%20business%20coaching'
DISCLAIMER = 'Estimates are for educational purposes and are not tax, accounting, or legal advice.'
TYPE_NAMES = {'solo': 'Solo Provider', 'employee': 'Employee', 'owner': 'Business Owner'}
# Licenses for the hub picker and each calculator's profession selector. Wording only: the math never depends on it.
# Keys and labels must match assets/calc/ui/professions.js (a test checks they do).
PROFESSIONS = [('esthetician', 'Esthetician'), ('cosmetologist', 'Cosmetologist/Hairstylist'),
               ('manicurist', 'Manicurist/Nail Technician'), ('barber', 'Barber')]
# The default (esthetician) example texts; the framework swaps in the chosen license's from assets/calc/ui/professions.js
# (profText). tests/calc-pages.test.mjs checks every static data-prof text matches the esthetician's there.
SIG = '<span data-prof="signature">60-minute signature facial</span>'
SIG_MIN = '<span data-prof="signature-minutes">60</span>'
SVC90 = '<span data-prof="service-90">90-minute back facial</span>'
COST_CARD = 'Add up the products and supplies behind a signature facial, chemical peel or hydrafacial, down to the gloves.'

esc = lambda s: html.escape(str(s), quote=True)

# ---------- the ten calculators (hub cards). live=False would show a "Coming soon" card with no link ----------
CALCS = [
    dict(slug='service-pricing', cat='Pricing', live=True, name='Service Pricing Calculator', audiences='solo owner',
         desc='Find a price that covers your costs, values your time, and supports your goals.', cta='Calculate Your Price',
         desc_employee='Prices set by the salon or spa? Use What Is Your Time Worth? to see what your hours need to earn.'),
    dict(slug='hourly-rate', cat='Pricing', live=True, name='What Is Your Time Worth?', audiences='solo employee owner',
         desc='Work out what every client hour needs to bring in to reach the income you want.', cta='Find Your Hourly Rate',
         desc_employee='See what each client hour needs to earn you to reach your take-home goal.'),
    dict(slug='service-cost', cat='Pricing', live=True, name='Cost Per Service Calculator', audiences='solo owner',
         desc=COST_CARD, desc_prof='cost-card', cta='Count Your Costs'),
    dict(slug='service-profitability', cat='Profitability', live=True, name='Service Profitability Calculator', audiences='solo owner',
         desc='See what a single service really earns, per appointment and per hour.', cta='Check a Service'),
    dict(slug='break-even', cat='Profitability', live=True, name='Break-Even Calculator', audiences='solo owner',
         desc='Find how many appointments a month cover your rent and other fixed costs.', cta='Find Your Break-Even'),
    dict(slug='profit-take-home', cat='Profitability', live=True, name='Profit & Take-Home Calculator', audiences='solo employee owner',
         desc='Separate business profit from what you actually take home.', cta='See Your Take-Home',
         desc_employee='Estimate your take-home pay from commission, wages, tips and bonuses.'),
    dict(slug='menu-profitability', cat='Profitability', live=True, name='Service Menu Profitability Analyzer', audiences='solo owner',
         desc='Rank every service on your menu by profit, margin and profit per hour.', cta='Analyze Your Menu'),
    dict(slug='capacity-clients', cat='Growth', live=True, name='Capacity & Clients Calculator', audiences='solo employee owner',
         desc='See how many clients a month your revenue goal really takes.', cta='Count Your Clients',
         desc_employee='Turn your pay goal into clients and hours a week, on flat or tiered commission, with any base wage and tips.'),
    dict(slug='price-increase', cat='Growth', live=True, name='Price Increase Calculator', audiences='solo owner',
         desc='See what a price increase is worth, and how many clients you could lose and still come out even.', cta='Test a Price Increase'),
    dict(slug='discount-promotion', cat='Promotions', live=True, name='Discount & Promotion Calculator', audiences='solo owner',
         desc='Find out what a discount really costs before you run the promo.', cta='Check a Discount'),
]
CATEGORIES = ['Pricing', 'Profitability', 'Growth', 'Promotions']
MORE = ['Pricing Guides', 'Business Templates', 'Marketing Tools']

# ---------- field helpers ----------
def F(key, label, unit, name, required=False, min_exclusive=False, max=None, max_exclusive=False, placeholder='',
      value='', hint='', types=None, labels=None, min=None, min_message='', when='', prof_placeholder='', integer=False):
    return dict(key=key, label=label, unit=unit, name=name, required=required, min_exclusive=min_exclusive, max=max,
                max_exclusive=max_exclusive, placeholder=placeholder, value=value, hint=hint, types=types, labels=labels or {},
                min=min, min_message=min_message, when=when, prof_placeholder=prof_placeholder, integer=integer)

def CHOICE(key, legend, options, types=None, value=None, when='', prof_default=''):
    """A radio group other fields can depend on (F(..., when='key:value other')). options: [(value, label)].
    prof_default: the choice follows the license (e.g. its signature service length) until the visitor picks one."""
    return dict(kind='choice', key=key, legend=legend, options=options, types=types, value=value or options[0][0], when=when,
                prof_default=prof_default)

def DURATION(placeholder_hint, **kw):
    """A service-duration field whose placeholder is the license's signature length (60 for a signature facial)."""
    return F('durationMinutes', 'Service duration', 'minutes', 'a service duration', max=1440, placeholder='60',
             prof_placeholder='signature-minutes', hint=placeholder_hint, **kw)

# Rent is its own input, shared across the hours worked: rent ÷ hours per month × service hours.
HOURS_DEFAULT = '160'
# Employees never see rent: the business pays it. Both fields are always limited to solo providers and owners.
def RENT(hint='Rent or suite fee for your room or space. It is shared across the hours you work, so longer services carry more of it.'):
    return F('monthlyRent', 'Monthly rent', 'money', 'monthly rent', max=MONEY_MAX, placeholder='2,000', hint=hint, types=['solo', 'owner'])
def HOURS():
    return F('hoursPerMonth', 'Hours you work per month', 'hours', 'the hours you work per month', required=True,
             min_exclusive=True, max=744, value=HOURS_DEFAULT,
             hint='Defaults to 160 (40 hours × 4 weeks). Rent is divided by these hours, then multiplied by the service length.',
             types=['solo', 'owner'])

def PCT(key, label, name, **kw):
    return F(key, label, 'percent', name, max=100, max_exclusive=True, **kw)

# ---------- labor: solo providers and owners only, never employees ----------
def MONTHLY_PAY(hint='What you pay yourself each month, before tax.'):
    return F('monthlyPay', 'Your monthly pay', 'money', 'your monthly pay', max=MONEY_MAX, placeholder='4,000', hint=hint, types=['solo'])
def PAYROLL(hint='Wages and payroll taxes for your team each month.'):
    return F('monthlyPayroll', 'Monthly payroll (wages + payroll taxes)', 'money', 'monthly payroll', max=MONEY_MAX, placeholder='6,500',
             hint=hint, types=['owner'])
def OWNER_PAY(hint='What you pay yourself each month. Leave blank if it is already in payroll.'):
    return F('ownerPay', 'Your monthly owner pay', 'money', 'your monthly owner pay', max=MONEY_MAX, placeholder='5,000',
             hint=hint, types=['owner'])
def COMMISSION(hint='The share of each service price paid to the provider.'):
    return PCT('commissionRate', 'Commission paid per service (%)', 'a commission', placeholder='40', hint=hint, types=['owner'])
def WAGE(hint='What you pay the provider per hour. Leave blank if they are paid on commission only.'):
    return F('providerWage', 'Provider’s hourly wage', 'money', 'an hourly wage', max=MONEY_MAX, placeholder='20', hint=hint, types=['owner'])
def PAY_PER_HOUR(required=False, hint='What an hour of your time should pay you, before tax. This is your labor cost.'):
    return F('targetHourly', 'Your pay per hour', 'money', 'your pay per hour', required=required, max=MONEY_MAX, placeholder='45',
             hint=hint, types=['solo'])

MONEY_MAX = 10_000_000
# Commission tiers (Capacity & Clients, employees on tiers): "from $X sales (or N services) → R%", first tier at 0, up to 6.
TIERS_HTML = ('<div class="calc-tiers-block" data-types="employee" data-when="payModel:sales services">'
    '<p class="calc-tiers-title" id="calc-tiers-h">Your commission tiers</p>'
    '<p class="calc-hint">The first tier starts at 0. Reaching a tier pays its rate on all your sales in that period, not only the sales above it.</p>'
    '<div class="calc-tiers" role="group" aria-labelledby="calc-tiers-h"></div>'
    '<p><button type="button" class="calc-add" data-action="add-tier">+ Add a tier</button></p>'
    '<template id="calc-tier-template"><div class="calc-row calc-row--tier">'
    '<div class="calc-row__cell"><label data-for="from">From sales a week</label><div class="calc-input">'
    '<span class="calc-affix" aria-hidden="true" data-tier-money>$</span><input data-col="from" type="text" inputmode="decimal" autocomplete="off">'
    '</div><p class="calc-error" hidden></p></div>'
    '<div class="calc-row__cell"><label data-for="rate">Rate</label><div class="calc-input"><input data-col="rate" type="text" inputmode="decimal" '
    'autocomplete="off"><span class="calc-affix calc-affix--end" aria-hidden="true">%</span></div><p class="calc-error" hidden></p></div>'
    '<button type="button" class="calc-row__remove" data-action="remove-tier" aria-label="Remove this tier">×</button>'
    '</div></template></div>')
AFFIX = {'money': ('$', ''), 'percent': ('', '%'), 'minutes': ('', 'min'), 'hours': ('', 'hrs'), 'number': ('', '')}

PAGES = {
    'service-pricing': dict(
        title='Beauty Service Pricing Calculator | GLOWDEGA', h1='Beauty Service Pricing Calculator',
        desc='Calculate what to charge for facials, peels, brows, lashes and hair services, based on your costs, time, '
             'expenses and desired earnings. Free, no sign-up.',
        intro=['Most beauty pros set prices by looking at the studio down the street. That number knows nothing about your rent, your product costs, or how long your signature service really takes. This calculator works from your numbers instead, and gives you a recommended price and range for a single service.',
               'Solo providers, such as a lash artist booking 60-minute lash lifts or a nail technician with a full book of gel manicures, enter the service length, what products and supplies cost each time, their monthly rent and what an hour of their time should pay them. Owners enter the provider’s hourly wage and any commission instead, so labor is priced the way it is really paid. Rent is shared by the hour: a 90-minute back facial in a $2,000-a-month suite, worked 160 hours a month, carries $18.75 of rent. Under “Customize your calculation” you can add other expenses, card fees and admin time.',
               'Every recommended price keeps a profit margin of at least 30%, so the business earns something after costs and pay. The result shows the lowest price that covers your costs and labor (break-even), the recommended price that adds your profit margin, and how your current price compares. Treat it as a starting point: local demand, your experience and your results still matter.'],
        types=['solo', 'employee', 'owner'], unsupported=['employee'],
        type_notes={'employee': 'Service prices are usually set by the business you work for. To see what your own time '
                    'needs to earn, use <a href="../hourly-rate/?type=employee">What Is Your Time Worth?</a> To see what your pay, '
                    'commission and tips leave you, use the <a href="../profit-take-home/?type=employee">Profit &amp; Take-Home Calculator</a>.'},
        basic=[F('currentPrice', 'Current service price', 'money', 'a current price', max=MONEY_MAX, placeholder='95',
                 hint='Leave blank for a new service.'),
               DURATION(f'Including set-up and consultation time. For a {SIG}, enter {SIG_MIN}.', required=True, min_exclusive=True),
               F('productCost', 'Product/supply cost', 'money', 'a product/supply cost', max=MONEY_MAX, placeholder='12.50',
                 hint='Per service. Not sure? Add it up with the <a href="../service-cost/">Cost Per Service Calculator</a>.'),
               RENT(),
               PAY_PER_HOUR(required=True),
               WAGE(), COMMISSION('The share of the price paid to the provider. The price is grossed up for it, like card fees.')],
        advanced=[HOURS(),
                  F('monthlyFixed', 'Other monthly fixed expenses', 'money', 'other monthly fixed expenses', max=MONEY_MAX, placeholder='400',
                    hint='Other expenses (not rent): insurance, software, licences.'),
                  F('monthlyVariable', 'Other monthly variable expenses', 'money', 'other monthly variable expenses', max=MONEY_MAX,
                    placeholder='300', hint='Other expenses (not rent) that rise and fall with how busy you are: laundry, marketing, backbar top-ups.'),
                  F('monthlyAppointments', 'Monthly service appointments', 'number', 'monthly appointments', max=100000,
                    placeholder='80', hint='All appointments across your menu, so other expenses are shared fairly.'),
                  PCT('processingRate', 'Payment processing', 'a payment processing rate', placeholder='2.9'),
                  PCT('profitMargin', 'Desired profit margin', 'a profit margin', required=True, min=30, value='30',
                      min_message='Enter a profit margin of at least 30%.',
                      hint='Profit kept by the business after costs and pay, as a share of the price. 30% is the minimum; you can set it higher.'),
                  F('nonClientHours', 'Non-client working hours per month', 'hours', 'non-client hours', max=744,
                    placeholder='20', hint='Admin, cleaning, ordering and content: time you work without a client.')],
        crumb_cat='Pricing'),
    'hourly-rate': dict(
        title='What Is Your Time Worth? Hourly Rate Calculator for Beauty Pros | GLOWDEGA', h1='What Is Your Time Worth?',
        desc='Work out what each client hour needs to bring in to reach your income goal, after expenses, taxes and '
             'non-client hours. For estheticians, stylists and beauty pros.',
        intro=['A barber who cuts hair six hours a day still works eight: there are clippers to clean, supplies to order, messages to answer and content to post. Those hours earn nothing on their own, so the hours you spend with clients have to carry them. This calculator shows how much.',
               'Solo providers and owners start with the income they want to keep, their monthly rent, other yearly business expenses and an estimated tax rate; owners add monthly payroll for their team. A solo provider’s income goal is their pay, so it is never added twice. Employees skip rent and expenses: choose whether you are paid hourly, on commission, or hourly plus commission, and add your average monthly tips. Paid hourly? Add your current wage to see whether it reaches your goal. Under “Customize your calculation” you can change the weeks, days and hours you work.',
               'Solo providers and owners see the revenue needed each year, each month, per working hour and per client hour, plus what a 90-minute silk press or a 60-minute signature facial should bring in. Employees see the hourly wage, or the monthly, weekly and per-client-hour service sales, that reach their take-home pay goal. The tax rate is a rough estimate, not tax advice.'],
        types=['solo', 'employee', 'owner'], unsupported=[],
        type_notes={'employee': 'As an employee you don’t pay rent or the business’s expenses. Choose how you are paid, '
                    'and this shows the wage or service sales that reach your take-home pay goal.'},
        basic=[F('desiredAnnualIncome', 'Desired annual take-home income', 'money', 'a desired annual income', required=True,
                 min_exclusive=True, max=100_000_000, placeholder='65,000', hint='What you want to keep after estimated income tax.',
                 labels={'employee': 'Desired annual take-home pay'}),
               CHOICE('payType', 'How are you paid?', [('hourly', 'Hourly'), ('commission', 'Commission'), ('mixed', 'Hourly + commission')],
                      types=['employee']),
               F('currentHourlyWage', 'Your current hourly wage', 'money', 'your current hourly wage', max=MONEY_MAX, placeholder='22',
                 hint='Leave blank to see just the wage you need, or enter it to compare with your goal.', types=['employee'], when='payType:hourly'),
               F('baseHourlyWage', 'Your current base hourly wage', 'money', 'your current base hourly wage', required=True, max=MONEY_MAX, placeholder='18',
                 hint='What you are paid per hour now, before commission and tips.', types=['employee'], when='payType:mixed'),
               PCT('commissionRate', 'Commission rate', 'a commission rate', required=True, min_exclusive=True, placeholder='40',
                   hint='Your share of the service price you perform.', types=['employee'], when='payType:commission mixed'),
               F('monthlyTips', 'Average monthly tips', 'money', 'monthly tips', max=MONEY_MAX, placeholder='400',
                 hint='Before tax. Tips count toward your take-home goal and are taxed like pay.', types=['employee']),
               RENT(hint='Rent or suite fee. It is counted 12 times a year on top of your other expenses.'),
               PAYROLL('Wages and payroll taxes for your team each month, counted 12 times a year. Your own pay is your income goal above.'),
               F('annualExpenses', 'Other annual business expenses', 'money', 'other annual business expenses', max=100_000_000,
                 placeholder='6,000', hint='Other expenses (not rent): products, insurance, software, education.',
                 types=['solo', 'owner']),
               PCT('taxRate', 'Estimated tax rate', 'an estimated tax rate', placeholder='25',
                   hint='A rough combined rate. A tax professional can give you yours.')],
        advanced=[F('workingWeeksPerYear', 'Working weeks per year', 'number', 'working weeks per year', required=True,
                    min_exclusive=True, max=52, value='48', hint='52 minus holidays, vacation and education days.'),
                  F('workingDaysPerWeek', 'Working days per week', 'number', 'working days per week', required=True,
                    min_exclusive=True, max=7, value='5'),
                  F('hoursPerDay', 'Hours worked per day', 'hours', 'hours per day', required=True, min_exclusive=True,
                    max=24, value='8'),
                  F('nonClientHoursPerDay', 'Non-client hours per day', 'hours', 'non-client hours per day', max=24, value='2',
                    hint='Admin, cleaning, ordering, content and gaps between clients.'),
                  F('exampleServiceMinutes', 'Example service length', 'minutes', 'a service length', required=True,
                    min_exclusive=True, max=1440, value='90', hint=f'Used for the “a service like this should bring in” line, such as a {SVC90}.')],
        crumb_cat='Pricing'),
    'service-cost': dict(
        title='Cost Per Service Calculator for Beauty Pros | GLOWDEGA', h1='Cost Per Service Calculator',
        desc='Add up the true product and supply cost of a facial, peel, lash lift, brow lamination or root touch-up, '
             'line by line, then use it to price the service.',
        intro=['A gel manicure looks cheap to deliver until you count everything that goes into it: base coat, color, top coat, cuticle oil, files, buffers and lint-free wipes. A chemical peel or a root touch-up tells the same story. Small costs add up, and they come out of every single appointment.',
               'This calculator is for anyone who performs services: estheticians, hairstylists, nail technicians, lash and brow artists, barbers and owners costing a menu. Add one line per item. Choose whether it is a product (enzyme mask, lash adhesive, color, developer), a supply (gloves, cotton, foils, applicators) or another consumable (laundry, single-use linens), then enter how much one service uses and what that amount costs. Solo providers and owners can add the service length, monthly rent and labor too: a 90-minute back facial in a $2,000-a-month room worked 160 hours a month carries $18.75 of rent.',
               'You get the product cost, supply cost, rent share, labor and the true cost per service. Send them straight into the Service Pricing Calculator to find a price that covers them, plus profit.'],
        types=['solo', 'owner'], unsupported=[],
        basic=[DURATION(f'Including set-up and consultation, e.g. {SIG_MIN} for a {SIG}. Needed to share rent and labor by time.', types=['solo', 'owner']),
               RENT(),
               MONTHLY_PAY('What you pay yourself each month. It is shared across the hours you work, like rent.'),
               WAGE(), COMMISSION(),
               F('price', 'Service price', 'money', 'a service price', max=MONEY_MAX, placeholder='120',
                 hint='Needed to count commission, which is a share of the price.', types=['owner'])],
        advanced=[HOURS()], rows=True, crumb_cat='Pricing'),
    'service-profitability': dict(
        title='Service Profitability Calculator for Beauty Pros | GLOWDEGA', h1='Service Profitability Calculator',
        desc='See what one beauty service really earns per appointment and per hour after products, overhead, card fees '
             'and labor, and compare it with your hourly target.',
        intro=['Two services can bring in the same price and earn very different amounts. A 90-minute back facial and a 60-minute brow lamination might both be on your menu at $120, but one uses more room time and far more product. This calculator shows what a single service earns once its costs, labor included, are paid.',
               'It is built for solo providers checking their own menu, from lash lifts to root touch-ups, and for owners whose services are performed by staff on wages or commission. Enter the price, how long the service takes, what the products and supplies cost, your monthly rent, which each service carries by the hour, and the labor: your own pay per hour if you work solo, or the provider’s hourly wage and commission if you own the business. Under “Customize your calculation” you can add other overhead, card processing and a target profit per hour.',
               'The result shows revenue, total cost, labor, profit or loss per appointment, profit margin, and profit and revenue per hour. If the service falls short, the Service Pricing Calculator works out a price that fixes it. Results are estimates to inform your decisions, not financial advice.'],
        types=['solo', 'employee', 'owner'], unsupported=['employee'],
        type_notes={'employee': 'Service profit belongs to the business you work for. To see what your own time needs to '
                    'earn, use <a href="../hourly-rate/?type=employee">What Is Your Time Worth?</a>'},
        basic=[F('price', 'Service price', 'money', 'a service price', required=True, min_exclusive=True, max=MONEY_MAX, placeholder='120'),
               DURATION(f'For a {SIG}, enter {SIG_MIN}.', required=True, min_exclusive=True),
               F('productCost', 'Product cost', 'money', 'a product cost', max=MONEY_MAX, placeholder='9'),
               F('supplyCost', 'Supply cost', 'money', 'a supply cost', max=MONEY_MAX, placeholder='3.50'),
               RENT(),
               PAY_PER_HOUR(hint='What an hour of your time should pay you. It is counted as labor, so profit is what is left after you are paid.'),
               WAGE(), COMMISSION()],
        advanced=[HOURS(),
                  F('overhead', 'Other overhead per appointment', 'money', 'other overhead', max=MONEY_MAX, placeholder='8',
                    hint='Other monthly expenses (not rent) ÷ monthly appointments.'),
                  PCT('processingRate', 'Payment processing', 'a payment processing rate', placeholder='2.9'),
                  F('targetProfitPerHour', 'Target profit per hour', 'money', 'a target profit per hour', max=MONEY_MAX, placeholder='30',
                    hint='Profit the business wants each hour, after labor.', types=['owner'])],
        crumb_cat='Profitability'),
    'break-even': dict(
        title='Break-Even Calculator for Salons, Spas & Beauty Studios | GLOWDEGA', h1='Break-Even Calculator',
        desc='Find how many appointments and how much revenue a month your beauty business needs to cover rent and fixed '
             'costs, with a simple visual explanation.',
        intro=['Rent is due whether you book four facials this week or forty. The break-even point is the number of appointments that covers those fixed costs. Below it you are paying to open the doors; above it, every appointment adds profit.',
               'This calculator is for solo providers renting a room or a chair, like an esthetician with a treatment room or a barber with a booth, and for owners of a salon, nail studio or spa. You need your monthly rent, your other fixed costs (insurance, software, loan payments), your labor, your average service price, the product and supply cost of one appointment and your card processing rate. Solo providers enter the pay they want each month; owners enter payroll, their own owner pay and any commission paid per service. Under “Customize your calculation” you can add retail sales per appointment and the days you work each week.',
               'The result shows break-even revenue and appointments per month, week and day, with a chart of where revenue overtakes costs. If each appointment costs more than it brings in, the calculator tells you plainly, because no number of bookings fixes that. It is a planning estimate, not accounting advice.'],
        types=['solo', 'employee', 'owner'], unsupported=['employee'],
        type_notes={'employee': 'Break-even is a business-owner number. To see what your own time needs to earn, use '
                    '<a href="../hourly-rate/?type=employee">What Is Your Time Worth?</a>'},
        basic=[RENT(hint='Rent or suite fee for the month. It is added to your other fixed costs.'),
               MONTHLY_PAY('What you pay yourself each month. It is a fixed cost, so break-even means you are paid too.'),
               PAYROLL(), OWNER_PAY(),
               F('fixedCosts', 'Other monthly fixed costs', 'money', 'other monthly fixed costs', max=MONEY_MAX, placeholder='1,200',
                 hint='Other fixed costs (not rent or pay): insurance, software, loan payments.'),
               F('servicePrice', 'Average service price', 'money', 'an average service price', required=True, min_exclusive=True,
                 max=MONEY_MAX, placeholder='110'),
               F('variableCost', 'Average variable cost per service', 'money', 'a variable cost', max=MONEY_MAX, placeholder='18',
                 hint='Products and supplies for one appointment. Commission has its own field.'),
               PCT('processingRate', 'Payment processing', 'a payment processing rate', placeholder='2.9'),
               COMMISSION('The share of each service price paid to the provider. It comes off what each appointment contributes.')],
        advanced=[F('retailRevenue', 'Average retail revenue per appointment', 'money', 'retail revenue', max=MONEY_MAX, placeholder='15'),
                  PCT('retailCostRate', 'Retail product cost', 'a retail product cost', placeholder='50',
                      hint='What you pay for the retail you sell, as a % of its price. Leave blank only if it cost you nothing.'),
                  F('workingDaysPerWeek', 'Working days per week', 'number', 'working days per week', required=True,
                    min_exclusive=True, max=7, value='5')],
        crumb_cat='Profitability'),
    'profit-take-home': dict(
        title='Profit & Take-Home Pay Calculator for Beauty Pros | GLOWDEGA', h1='Profit & Take-Home Calculator',
        desc='Separate business profit from the pay you take home. For salon and studio owners, solo beauty pros, and employees '
             'paid hourly or on commission.',
        intro=['Money coming in is not the same as money you keep. A lash studio can book $12,000 of services in a month and still leave its owner short once rent, products, payroll and taxes are paid. This calculator separates business profit from the pay that actually reaches you.',
               'Solo providers and owners enter a month of service revenue, product and service costs, rent, other fixed expenses and an estimated tax rate. Solo providers add their monthly pay; owners add payroll, commission paid to providers and their own owner pay. Under “Customize your calculation” you can add retail sales and variable expenses. How the numbers fit together: your pay is a business expense, business profit is what remains after every expense including your pay, and your take-home is your pay plus that profit, minus estimated taxes. Your pay is counted once, never twice.',
               'Employees skip all of that. A barber on commission or a nail technician paid by the hour enters their pay type, service revenue, commission rate or wage and hours, tips and bonuses, and sees gross earnings, estimated taxes, take-home pay and effective hourly earnings. Tax figures are rough estimates, not tax advice.'],
        types=['solo', 'employee', 'owner'], unsupported=[],
        type_notes={'employee': 'As an employee, your take-home comes from your pay, not the business’s profit. The business pays '
                    'the rent and expenses, so you won’t see them here. Choose how you are paid.'},
        basic=[F('serviceRevenue', 'Monthly service revenue', 'money', 'monthly service revenue', required=True, max=MONEY_MAX,
                 placeholder='12,000', hint='Everything clients paid for services this month, before any costs.', types=['solo', 'owner']),
               CHOICE('payType', 'How are you paid?', [('hourly', 'Hourly'), ('commission', 'Commission'), ('mixed', 'Hourly + commission')],
                      types=['employee']),
               F('revenueGenerated', 'Monthly service revenue you generate', 'money', 'the monthly service revenue you generate', required=True,
                 min_exclusive=True, max=MONEY_MAX, placeholder='9,000', hint='The total price of the services you performed this month.',
                 types=['employee'], when='payType:commission mixed'),
               PCT('payCommissionRate', 'Your commission rate', 'a commission rate', required=True, min_exclusive=True, placeholder='40',
                   hint='Your share of the service revenue you generate.', types=['employee'], when='payType:commission mixed'),
               F('hourlyWage', 'Your hourly wage', 'money', 'an hourly wage', required=True, min_exclusive=True, max=MONEY_MAX, placeholder='18',
                 types=['employee'], when='payType:hourly mixed'),
               F('hoursWorked', 'Hours worked per month', 'hours', 'the hours you work per month', required=True, min_exclusive=True, max=744,
                 placeholder='140', hint='Paid hours this month.', types=['employee'], when='payType:hourly mixed'),
               F('hoursOptional', 'Hours worked per month', 'hours', 'the hours you work per month', max=744, placeholder='140',
                 hint='Add them to see your effective hourly earnings.', types=['employee'], when='payType:commission'),
               F('tips', 'Monthly tips', 'money', 'monthly tips', max=MONEY_MAX, placeholder='400', hint='Before tax.', types=['employee']),
               F('productCosts', 'Product/service costs', 'money', 'product/service costs', max=MONEY_MAX, placeholder='1,200',
                 hint='Products and supplies used in services, plus what the retail you sold cost you.', types=['solo', 'owner']),
               RENT(hint='Rent or suite fee for the month. It is its own expense, kept out of other fixed expenses.'),
               F('fixedExpenses', 'Other monthly fixed expenses', 'money', 'other monthly fixed expenses', max=MONEY_MAX, placeholder='600',
                 hint='Other fixed expenses (not rent or pay): insurance, software, booking app, loan payments.', types=['solo', 'owner']),
               MONTHLY_PAY('What you pay yourself this month. It is a business expense, and it comes back to you in your take-home, so it is counted once.'),
               PAYROLL('Wages and payroll taxes for your team. Leave your own pay out; it has its own field.'),
               COMMISSION('The share of service revenue paid to providers. It is a business expense.'),
               OWNER_PAY('What you pay yourself this month. It is a business expense, and it comes back to you in your take-home, so it is counted once.'),
               PCT('taxRate', 'Estimated tax rate', 'an estimated tax rate', placeholder='25',
                   hint='A rough combined rate on what you earn. A tax professional can give you yours.')],
        advanced=[F('retailRevenue', 'Monthly retail revenue', 'money', 'retail revenue', max=MONEY_MAX, placeholder='800',
                    hint='Products sold to clients. Their cost goes in product/service costs.', types=['solo', 'owner']),
                  F('variableExpenses', 'Monthly variable expenses', 'money', 'monthly variable expenses', max=MONEY_MAX, placeholder='450',
                    hint='Other expenses (not rent) that rise and fall with how busy you are: card fees, laundry, marketing.', types=['solo', 'owner']),
                  F('bonuses', 'Monthly bonuses', 'money', 'monthly bonuses', max=MONEY_MAX, placeholder='150',
                    hint='Retail commission, rebooking or other bonuses, before tax.', types=['employee'])],
        crumb_cat='Profitability'),
    'capacity-clients': dict(
        title='Capacity & Clients Calculator for Beauty Businesses | GLOWDEGA', h1='Capacity & Clients Calculator',
        desc='Turn a revenue or pay goal into clients a week and a month and the hours it takes, with flat or tiered commission '
             'for employees.',
        intro=['A goal is easier to plan for once it becomes a number of clients. $8,000 a month at a $100 average ticket is 80 clients; at $160 it is 50. This calculator turns your goal into clients a week and a month, and the hours they take.',
               'Solo providers and owners enter a monthly revenue goal, their average service price, the days they work a month and whether the average service runs 60 or 90 minutes; an esthetician can weigh a higher ticket against a fuller book. Under “Customize your calculation” you can add the clients you see now and your current ticket to measure the gap.',
               'Employees start from pay instead: a pre-tax pay goal for a week or a month, then how commission works. A barber on a flat 45%, a hairstylist whose rate rises with weekly sales, a nail technician paid by services a week: each enters their rate or tiers, plus any base hourly wage and tips. Reaching a tier pays its rate on all sales in that period, so the results show the tier your goal reaches and how many more clients unlock the next one, which can pay more for just a few extra bookings. Hours and days a week follow from your average service length.',
               'It plans bookings and pay only: rent, pay and other costs belong in the Break-Even and Profit & Take-Home calculators.'],
        types=['solo', 'employee', 'owner'], unsupported=[],
        type_notes={'employee': 'Set your pay goal before tax and how you are paid: a flat commission, or tiers by sales or by services a '
                    'week, plus any base wage and tips. You’ll see the clients and hours it takes, and what the next tier would pay. '
                    'To see what you keep after tax, use the <a href="../profit-take-home/?type=employee">Profit &amp; Take-Home Calculator</a>.'},
        basic=[CHOICE('goalPeriod', 'Your pay goal is for a', [('month', 'Month'), ('week', 'Week')], types=['employee']),
               F('incomeGoal', 'Your pay goal (before tax)', 'money', 'a pay goal', required=True, min_exclusive=True, max=100_000_000,
                 placeholder='4,000', hint='Pre-tax pay for the period: commission, base wage and tips together.', types=['employee']),
               F('revenueGoal', 'Monthly revenue goal', 'money', 'a monthly revenue goal', required=True, min_exclusive=True, max=100_000_000,
                 placeholder='8,000', hint='The service revenue you want to bring in each month.', types=['solo', 'owner']),
               F('averageTicket', 'Average service price', 'money', 'an average service price', required=True, min_exclusive=True, max=MONEY_MAX,
                 placeholder='120', hint='What a client spends on services per visit, on average.',
                 min_message='Enter an average service price greater than $0.'),
               CHOICE('payModel', 'How is your commission paid?', [('flat', 'Flat commission %'), ('sales', 'Tiered by sales'),
                      ('services', 'Tiered by services per week')], types=['employee']),
               PCT('flatRate', 'Commission rate', 'a commission rate', required=True, placeholder='40',
                   hint='Your share of the service price. 0% if you are paid by the hour only.', types=['employee'], when='payModel:flat'),
               CHOICE('tierPeriod', 'Sales tiers count sales per', [('week', 'Week'), ('month', 'Month')], types=['employee'], when='payModel:sales'),
               dict(kind='html', html=TIERS_HTML),
               F('baseWage', 'Base hourly wage', 'money', 'a base hourly wage', max=MONEY_MAX, placeholder='15',
                 hint='Paid for every hour you work, with clients or not. Leave blank if you are paid commission only.', types=['employee']),
               F('tipPerClient', 'Average tip per client', 'money', 'an average tip', max=MONEY_MAX, placeholder='15',
                 hint='Before tax. Tips count toward your pay goal.', types=['employee']),
               F('workingDaysPerMonth', 'Working days per month', 'number', 'working days per month', required=True, min_exclusive=True,
                 max=31, value='20', types=['solo', 'owner']),
               CHOICE('serviceMinutes', 'Average service length', [('60', '60 minutes'), ('90', '90 minutes')], prof_default='signature-minutes')],
        advanced=[F('currentClients', 'Current monthly clients', 'number', 'current monthly clients', max=100000, placeholder='55',
                    hint='Clients you see in a typical month now.', types=['solo', 'owner']),
                  F('currentTicket', 'Current average ticket', 'money', 'a current average ticket', max=MONEY_MAX, placeholder='105',
                    hint='Leave blank to use your average service price.', types=['solo', 'owner']),
                  F('nonClientHours', 'Non-client hours per week', 'hours', 'non-client hours a week', max=167, placeholder='4',
                    hint='Cleaning, restocking, meetings and content: hours you work without a client.', types=['employee']),
                  F('hoursPerDay', 'Hours you work per day', 'hours', 'hours per day', required=True, min_exclusive=True, max=24, value='8',
                    hint='Turns the hours a week into days a week.', types=['employee'])],
        crumb_cat='Growth'),
    'price-increase': dict(
        title='Price Increase Calculator for Salons & Beauty Pros | GLOWDEGA', h1='Price Increase Calculator',
        desc='See what raising a beauty service price adds to revenue and profit, and how many clients you could lose and still '
             'bring in the same revenue.',
        intro=['Raising prices feels risky because some clients may leave. The math is often kinder than the fear. If a 60-minute signature facial goes from $100 to $115, you could lose about one client in eight and still bring in the same service revenue, while working fewer hours.',
               'This calculator is for solo providers and owners: a nail technician updating a gel manicure price, a barber moving a cut & beard up, a studio adjusting its menu one service at a time. Enter the current and new price, monthly appointments for the service, its length and product cost, your monthly rent and labor: your pay per hour if you work solo, or the provider’s wage and commission if you own the business. Rent is shared by the hour, and commission rises with the price. Under “Customize your calculation” you can add card processing and the share of clients you expect to lose.',
               'You see current and new monthly revenue and profit, the monthly and yearly increase, and how many clients you could lose before revenue falls below where it is today. It is a planning estimate: how your clients respond is still yours to judge.'],
        types=['solo', 'owner'], unsupported=[],
        basic=[F('currentPrice', 'Current service price', 'money', 'a current service price', required=True, min_exclusive=True, max=MONEY_MAX,
                 placeholder='100'),
               F('newPrice', 'New service price', 'money', 'a new service price', required=True, min_exclusive=True, max=MONEY_MAX, placeholder='115'),
               F('monthlyAppointments', 'Monthly appointments for this service', 'number', 'monthly appointments', required=True,
                 min_exclusive=True, max=100000, placeholder='60'),
               DURATION(f'Including set-up. For a {SIG}, enter {SIG_MIN}.', required=True, min_exclusive=True),
               F('productCost', 'Product/supply cost', 'money', 'a product/supply cost', max=MONEY_MAX, placeholder='12', hint='Per service.'),
               RENT(),
               PAY_PER_HOUR(hint='What an hour of your time should pay you. It is counted as labor, so profit is what is left after you are paid.'),
               WAGE(), COMMISSION('The share of the price paid to the provider. It rises with the new price.')],
        advanced=[HOURS(),
                  PCT('processingRate', 'Payment processing', 'a payment processing rate', placeholder='2.9'),
                  PCT('expectedLoss', 'Expected client loss', 'an expected client loss', placeholder='5',
                      hint='The share of this service’s clients you think may leave. Leave blank to see how many you could lose.')],
        crumb_cat='Growth'),
    'discount-promotion': dict(
        title='Discount & Promotion Calculator for Beauty Businesses | GLOWDEGA', h1='Discount & Promotion Calculator',
        desc='Find what a discount really costs a beauty service: sale price, profit lost, the break-even discount and the deepest '
             'discount that keeps your margin.',
        intro=['A 20% discount does not cost 20% of your profit. It usually costs far more, because products, rent and labor cost the same whether the client pays full price or not. On a $150 service that earns $60 after costs, a $30 discount takes half the profit.',
               'Use this before you run a new-client special, a holiday lash promotion or a brow and tint bundle. Solo providers and owners enter the regular price, the discount, the service length and product cost, monthly rent and labor: your pay per hour if you work solo, or the provider’s wage and commission if you own the business. Commission is paid on the sale price, so it falls with the discount. Add how many promotional appointments you expect to see the whole promotion. Under “Customize your calculation” you can add other overhead, card processing and your target profit margin (30% or more).',
               'The result shows the sale price, profit before and after the discount, profit lost per appointment, the break-even discount where profit reaches $0 with labor paid, and the deepest discount that still keeps your target margin. It is an estimate to plan with, not a promise of how a promotion will perform.'],
        types=['solo', 'owner'], unsupported=[],
        basic=[F('regularPrice', 'Regular service price', 'money', 'a regular service price', required=True, min_exclusive=True, max=MONEY_MAX,
                 placeholder='150'),
               PCT('discountRate', 'Discount', 'a discount', required=True, placeholder='20', hint='0% shows the service at full price.'),
               F('promoAppointments', 'Promotional appointments', 'number', 'promotional appointments', max=100000, placeholder='25',
                 hint='How many discounted appointments you expect. Leave blank to see one appointment.'),
               DURATION(f'Including set-up. For a {SIG}, enter {SIG_MIN}.', required=True, min_exclusive=True),
               F('productCost', 'Product/supply cost', 'money', 'a product/supply cost', max=MONEY_MAX, placeholder='15', hint='Per service.'),
               RENT(),
               PAY_PER_HOUR(hint='What an hour of your time should pay you. It is counted as labor, so the break-even discount still pays you.'),
               WAGE(), COMMISSION('The share of the price paid to the provider. It is paid on the sale price, so it falls with the discount.')],
        advanced=[HOURS(),
                  F('overhead', 'Other overhead per appointment', 'money', 'other overhead', max=MONEY_MAX, placeholder='8',
                    hint='Other monthly expenses (not rent) ÷ monthly appointments.'),
                  PCT('processingRate', 'Payment processing', 'a payment processing rate', placeholder='2.9'),
                  PCT('targetMargin', 'Target profit margin', 'a profit margin', required=True, min=30, value='30',
                      min_message='Enter a profit margin of at least 30%.',
                      hint='Profit kept after costs and pay, as a share of the sale price. 30% is the minimum; you can set it higher.')],
        crumb_cat='Promotions'),
    'menu-profitability': dict(
        title='Service Menu Profitability Analyzer for Beauty Pros | GLOWDEGA', h1='Service Menu Profitability Analyzer',
        desc='Compare every service on your beauty menu by profit, margin and profit per hour, with rent and labor included, '
             'and see which ones lead and lag.',
        intro=['Most menus have one service that earns far more per hour than the rest, and one that barely covers its costs. Side by side the difference is easy to see; on a booking screen it is not.',
               'Add each service you offer: a 60-minute signature facial, a 90-minute root touch-up, a lash lift, a gel manicure. Enter the price, how long it takes, and its product and supply cost. Solo providers add their pay per hour, which is counted as labor on every service. Owners add the provider’s hourly wage and commission for each service instead. Monthly rent is shared by the hour, so a 90-minute service carries more of it than a 60-minute one. Under “Customize your calculation” you can change the hours you work each month and add card processing.',
               'The analyzer ranks your services by profit per appointment, profit per hour and margin, names the one earning the least per hour, and points out where a closer look at price or length may help. It is a starting point for a menu review, not a verdict on any service.'],
        types=['solo', 'owner'], unsupported=[],
        type_notes={'owner': 'Enter each service’s provider wage per hour and commission in its row. Leave the wage blank for '
                    'commission-only providers.'},
        basic=[RENT(), PAY_PER_HOUR(hint='Your labor cost per hour of service time, counted on every service.')],
        advanced=[HOURS(), PCT('processingRate', 'Payment processing', 'a payment processing rate', placeholder='2.9')],
        rows='menu', crumb_cat='Profitability'),
}

# ---------- rendering ----------
def choice_html(c):
    types = f' data-types="{" ".join(c["types"])}"' if c['types'] else ''
    if c.get('when'): types += f' data-when="{esc(c["when"])}"'
    if c.get('prof_default'): types += f' data-prof-default="{c["prof_default"]}"'
    return (f'<fieldset class="calc-type calc-choice"{types}><legend>{esc(c["legend"])}</legend><div class="calc-type__options">'
            + ''.join(f'<label><input type="radio" name="{c["key"]}" value="{v}"{" checked" if v == c["value"] else ""}><span>{esc(l)}</span></label>'
                      for v, l in c['options'])
            + '</div></fieldset>')

def field_html(f):
    if f.get('kind') == 'choice': return choice_html(f)
    if f.get('kind') == 'html': return f['html']
    pre, suf = AFFIX[f['unit']]
    fid = 'f-' + f['key']
    attrs = [f'id="{fid}"', f'name="{f["key"]}"', 'type="text"', 'inputmode="decimal"', 'autocomplete="off"',
             f'data-name="{esc(f["name"])}"', f'data-unit="{f["unit"]}"']
    if f['required']: attrs.append('data-required aria-required="true"')
    if f['min'] is not None: attrs.append(f'data-min="{f["min"]}"')
    if f['min_exclusive']: attrs.append('data-min-exclusive')
    if f['min_message']: attrs.append(f'data-min-message="{esc(f["min_message"])}"')
    if f['max'] is not None: attrs.append(f'data-max="{f["max"]}"')
    if f['max_exclusive']: attrs.append('data-max-exclusive')
    if f['placeholder']: attrs.append(f'placeholder="{esc(f["placeholder"])}"')
    if f['prof_placeholder']: attrs.append(f'data-prof-placeholder="{f["prof_placeholder"]}"')
    if f['integer']: attrs.append('data-integer')
    if f['value']: attrs.append(f'value="{esc(f["value"])}"')
    described = (f'{fid}-hint ' if f['hint'] else '') + f'{fid}-error'
    attrs.append(f'aria-describedby="{described}"')
    labels = ''.join(f' data-label-{t}="{esc(v)}"' for t, v in f['labels'].items())
    opt = '' if f['required'] else ' <span class="calc-optional">optional</span>'
    types = f' data-types="{" ".join(f["types"])}"' if f['types'] else ''
    if f['when']: types += f' data-when="{esc(f["when"])}"'
    return (f'<div class="calc-field"{types}><label for="{fid}"><span class="calc-label"{labels}>{esc(f["label"])}</span>{opt}</label>'
            f'<div class="calc-input">' + (f'<span class="calc-affix" aria-hidden="true">{pre}</span>' if pre else '')
            + f'<input {" ".join(attrs)}>' + (f'<span class="calc-affix calc-affix--end" aria-hidden="true">{suf}</span>' if suf else '')
            + '</div>' + (f'<p class="calc-hint" id="{fid}-hint">{f["hint"]}</p>' if f['hint'] else '')
            + f'<p class="calc-error" id="{fid}-error" hidden></p></div>')

ROW_TEMPLATE = ('<template id="calc-row-template"><div class="calc-row">'
    '<div class="calc-row__cell"><label data-for="cat">Type</label><select data-col="cat"><option value="product">Product</option>'
    '<option value="supply">Supplies</option><option value="other">Other consumable</option></select></div>'
    '<div class="calc-row__cell calc-row__name"><label data-for="name">Item</label><input data-col="name" type="text" autocomplete="off" '
    'placeholder="e.g. enzyme mask, gloves"></div>'
    '<div class="calc-row__cell"><label data-for="qty">Quantity used</label><input data-col="qty" type="text" inputmode="decimal" '
    'autocomplete="off" value="1"><p class="calc-error" hidden></p></div>'
    '<div class="calc-row__cell"><label data-for="cost">Unit cost</label><div class="calc-input"><span class="calc-affix" aria-hidden="true">$</span>'
    '<input data-col="cost" type="text" inputmode="decimal" autocomplete="off" placeholder="2.50"></div><p class="calc-error" hidden></p></div>'
    '<button type="button" class="calc-row__remove" data-action="remove-row" aria-label="Remove this item">×</button>'
    '</div></template>')

def _menu_cell(col, label, affix='', end='', owner=False, cls='calc-row__cell', placeholder=''):
    mode = '' if col == 'name' else 'inputmode="decimal" '
    inp = (f'<input data-col="{col}" type="text" {mode}autocomplete="off"'
           + (f' placeholder="{placeholder}"' if placeholder else '') + '>')
    if affix or end:
        inp = ('<div class="calc-input">' + (f'<span class="calc-affix" aria-hidden="true">{affix}</span>' if affix else '') + inp
               + (f'<span class="calc-affix calc-affix--end" aria-hidden="true">{end}</span>' if end else '') + '</div>')
    return (f'<div class="{cls}"{" data-owner-only" if owner else ""}><label data-for="{col}">{label}</label>{inp}'
            + ('' if col == 'name' else '<p class="calc-error" hidden></p>') + '</div>')

# One service per row. Wage and commission are owners' labor; the page hides them unless "Business Owner" is chosen.
MENU_ROW_TEMPLATE = ('<template id="calc-row-template"><div class="calc-row calc-row--menu">'
    + _menu_cell('name', 'Service', cls='calc-row__cell calc-row__name', placeholder='e.g. Signature Facial')
    + _menu_cell('price', 'Price', affix='$', placeholder='120')
    + _menu_cell('duration', 'Minutes', end='min', placeholder='60')
    + _menu_cell('product', 'Product cost', affix='$', placeholder='9')
    + _menu_cell('supply', 'Supply cost', affix='$', placeholder='3')
    + _menu_cell('wage', 'Provider wage/hour', affix='$', owner=True, placeholder='20')
    + _menu_cell('commission', 'Commission', end='%', owner=True, placeholder='40')
    + '<button type="button" class="calc-row__remove" data-action="remove-row" aria-label="Remove this service">×</button>'
    '</div></template>')

SHARE_PANEL = ('<div class="calc-share-panel share-controls" hidden><h3>Share your result</h3>'
    '<p>Download a card sized for your platform, then post it yourself from the app. Websites can’t post to Instagram, '
    'TikTok or Threads for you, and we never will.</p><div class="calc-share-buttons">'
    '<button type="button" class="cta" data-share="story">Story card · 1080×1920</button>'
    '<button type="button" class="cta" data-share="social">Social card · 1200×675</button>'
    '<button type="button" class="cta" data-share="copy">Copy link</button>'
    '<a class="cta" data-share="email" href="mailto:">Email</a></div>'
    '<ul class="calc-share-guide"><li><strong>Instagram Story:</strong> download the Story card, open Instagram, add a story and pick the card from your photos.</li>'
    '<li><strong>TikTok:</strong> download the Story card and add it to a photo post.</li>'
    '<li><strong>Threads:</strong> download the Social card or copy the link, then start a new thread.</li></ul>'
    '<p class="calc-share-status" role="status"></p></div>')

COACHING_CTA = ('<aside class="coaching-cta" aria-label="Coaching"><p><strong>Want help putting these numbers into action?</strong> '
    'Get personalized help from a beauty business coach.</p><a class="cta" href="' + COACHING + '">Learn About Coaching</a></aside>')

def calculator_main(slug, p, script):
    calc = next(c for c in CALCS if c['slug'] == slug)
    types = ''
    if p['types']:
        types = ('<fieldset class="calc-type"><legend>Who are you?</legend><div class="calc-type__options">'
                 + ''.join(f'<label><input type="radio" name="businessType" value="{t}"><span>{TYPE_NAMES[t]}</span></label>' for t in p['types'])
                 + '</div></fieldset>'
                 + ''.join(f'<div class="calc-type-note" data-for-type="{t}" hidden><p>{n}</p></div>' for t, n in p.get('type_notes', {}).items()))
    # profession: wording only (example services in hints and results); pre-set from ?profession= or the hub choice
    types += ('<div class="calc-profession"><label for="f-profession">Your license</label><select id="f-profession" name="profession">'
              + ''.join(f'<option value="{k}"{" selected" if k == PROFESSIONS[0][0] else ""}>{esc(l)}</option>' for k, l in PROFESSIONS)
              + '</select><p class="calc-hint">Changes the example services in the wording only. The math is the same for every license.</p></div>')
    rows = ''
    if p.get('rows') == 'menu':
        rows = ('<div class="calc-rows calc-rows--menu" role="group" aria-label="Services on your menu"></div>'
                '<p><button type="button" class="calc-add" data-action="add-row">+ Add a service</button></p>' + MENU_ROW_TEMPLATE)
    elif p.get('rows'):
        rows = ('<div class="calc-rows" role="group" aria-label="Products and supplies"></div>'
                '<p><button type="button" class="calc-add" data-action="add-row">+ Add an item</button></p>' + ROW_TEMPLATE)
    fields = (rows + ''.join(field_html(f) for f in p['basic'])
              + (('<details class="calc-advanced"><summary>Customize your calculation</summary><div class="calc-advanced__body">'
                  + ''.join(field_html(f) for f in p['advanced']) + '</div></details>') if p['advanced'] else ''))
    intro = ''.join(f'<p>{x}</p>' for x in p['intro'])
    return (f'<section class="calc-page"><nav class="eyebrow calc-crumbs" aria-label="Breadcrumb"><a href="../../index.html">GLOWDEGA®</a> / '
            f'<a href="../">Resources</a> / <span aria-current="page">{esc(p["crumb_cat"])}</span></nav>'
            f'<h1>{esc(p["h1"])}</h1><div class="calc-intro">{intro}</div>'
            f'<div class="calc-print-head print-only"><strong>GLOWDEGA® · {esc(p["h1"])}</strong> <span class="calc-print-date"></span></div>'
            f'<div class="calc" data-calc="{slug}" data-calc-name="{esc(calc["name"] if slug != "hourly-rate" else "What Is Your Time Worth? Calculator")}">'
            f'<form class="calc-form calculator-inputs" novalidate aria-labelledby="calc-inputs-h"><h2 id="calc-inputs-h">Your numbers</h2>{types}'
            f'<div class="calc-body">{fields}<button type="submit" class="calc-submit">Calculate</button></div></form>'
            f'<section class="calc-results" aria-labelledby="calc-results-h"><h2 id="calc-results-h">Your results</h2>'
            f'<div class="calc-output" aria-live="polite"><p class="calc-empty">Enter your numbers and select Calculate to see your results.</p></div>'
            f'<div class="calc-actions share-controls" hidden><button type="button" class="cta" data-action="print">Print results</button>'
            f'<button type="button" class="cta" data-action="share">Share results</button>'
            f'<a class="cta" data-action="email" href="mailto:">Email results</a>'
            f'<button type="button" class="calc-link" data-action="more">More ways to share</button></div>{SHARE_PANEL}'
            f'{COACHING_CTA}<p class="calc-disclaimer">{DISCLAIMER}</p></section></div>'
            f'<noscript><p class="calc-disclaimer">This calculator needs JavaScript. Everything runs in your browser; nothing you enter is sent anywhere.</p></noscript>'
            f'<p class="calc-privacy">Your numbers stay in your browser. Nothing you enter is stored or sent to us.</p>'
            f'<p class="calc-back"><a href="../">← All beauty business calculators</a></p></section>'
            f'<script type="module" src="{script}"></script>')

def breadcrumbs(items):
    return {'@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': i + 1, 'name': n, 'item': ORIGIN + u} for i, (n, u) in enumerate(items)]}

def calculator_ld(slug, p):
    url = f'{ORIGIN}/resources/{slug}/'
    return {'@context': 'https://schema.org', '@graph': [
        {'@type': 'WebPage', '@id': url, 'url': url, 'name': p['title'], 'description': p['desc'], 'inLanguage': 'en-US',
         'isPartOf': {'@type': 'WebSite', 'name': 'GLOWDEGA®', 'url': ORIGIN + '/'}},
        {'@type': 'WebApplication', 'name': p['h1'], 'url': url, 'description': p['desc'],
         'applicationCategory': 'BusinessApplication', 'operatingSystem': 'Any', 'browserRequirements': 'Requires JavaScript',
         'isAccessibleForFree': True, 'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'},
         'publisher': {'@type': 'Organization', 'name': 'GLOWDEGA®'}},
        breadcrumbs([('GLOWDEGA®', '/'), ('Resources', '/resources/'), (p['h1'], f'/resources/{slug}/')]),
    ]}

def hub_card(c):
    aud = {'solo owner': 'Solo providers & owners', 'solo employee owner': 'Solo providers, employees & owners'}[c['audiences']]
    data = (f' data-audiences="{c["audiences"]}"' + (f' data-desc-employee="{esc(c["desc_employee"])}"' if c.get('desc_employee') else '')
            + (f' data-desc-prof="{c["desc_prof"]}"' if c.get('desc_prof') else ''))
    inner = f'<div class="hub-card__meta">{esc(aud)}</div><h3>{esc(c["name"])}</h3><p class="hub-card__desc">{esc(c["desc"])}</p>'
    if c['live']:
        types = ' '.join(t for t in PAGES[c['slug']]['types'] if t not in PAGES[c['slug']]['unsupported'])
        return (f'<a class="hub-card" href="{c["slug"]}/"{data} data-types="{types}">{inner}'
                f'<span class="hub-card__cta">{esc(c["cta"])} →</span></a>')
    return f'<div class="hub-card is-soon" aria-disabled="true"{data}>{inner}<span class="soon-pill">Coming soon</span></div>'

def hub_main():
    cats = ''.join(
        (lambda n: f'<section class="hub-cat" aria-labelledby="cat-{c.lower()}"><div class="grid-head"><h2 id="cat-{c.lower()}">{c}</h2>'
        f'<span>{n} tool{"s" if n != 1 else ""}</span></div><div class="hub-grid">'
        + ''.join(hub_card(x) for x in CALCS if x['cat'] == c) + '</div></section>')(sum(1 for x in CALCS if x['cat'] == c)) for c in CATEGORIES)
    more = ('<section class="hub-more" aria-labelledby="more-h"><div class="grid-head"><h2 id="more-h">Additional Resources</h2><span>Coming soon</span></div>'
            '<p>More free beauty business tools are coming soon.</p><ul class="hub-more__list">'
            + ''.join(f'<li class="hub-soon" aria-disabled="true"><span>{m}</span><span class="soon-pill">Coming soon</span></li>' for m in MORE)
            + '</ul></section>')
    return ('<div data-hub><section class="page-shell hub-hero"><div class="eyebrow">GLOWDEGA® / RESOURCES</div>'
            '<h1>Beauty Business Calculators</h1><p class="hub-lede">Free tools to help you price your services, understand your '
            'numbers, and grow your business.</p><p class="hub-sub">Built for estheticians, lash and brow artists, hairstylists, barbers, '
            'nail techs and studio owners. No sign-up; your numbers stay in your browser.</p>'
            + hub_gate() + '</section>'
            f'<div class="hub-body">{cats}{more}<p class="calc-disclaimer">{DISCLAIMER}</p></div></div>')

# The gate: "I'm a Licensed [profession] and a [worker type]". Progressive enhancement: the inline line below marks the
# page as able to run the hub module; only then is the picker shown and the cards hidden until both are chosen. With
# JavaScript off, the picker stays hidden and every card is visible (and always in the HTML for crawlers).
GATE_FLAG = '<script>if(\'noModule\' in HTMLScriptElement.prototype)document.documentElement.classList.add(\'hub-js\')</script>'

def hub_gate():
    prof = ''.join(f'<option value="{k}">{esc(l)}</option>' for k, l in PROFESSIONS)
    kinds = ''.join(f'<option value="{t}">{TYPE_NAMES[t]}</option>' for t in ['solo', 'employee', 'owner'])
    return (GATE_FLAG
            + '<form class="hub-gate" data-hub-gate aria-label="Choose your license and how you work"><p class="hub-gate__sentence">'
            '<span>I’m a Licensed</span> <select name="profession" aria-label="Your license"><option value="">choose your license</option>'
            + prof + '</select> <span>and a</span> <select name="type" aria-label="How you work"><option value="">choose how you work</option>'
            + kinds + '</select> <button type="submit" class="hub-change" data-hub-done hidden>Done</button></p>'
            '<p class="hub-gate__help">Choose both to see the calculators for you.</p></form>'
            '<p class="hub-chosen" data-hub-chosen tabindex="-1" hidden><span class="hub-chosen__text"></span> '
            '<button type="button" class="hub-change" data-hub-change>Change</button></p>'
            '<noscript><p class="hub-status">Every calculator is listed below. Each one opens with a choice of Solo Provider, '
            'Employee or Business Owner.</p></noscript>')

HUB = dict(title='Free Beauty Business Calculators | GLOWDEGA',
           desc='Free calculators for beauty professionals: price services, find your hourly rate and break-even, check profit '
                'and take-home pay, and test discounts and price increases.')

def version(site):
    h = hashlib.sha256()
    base = os.path.join(site, 'assets', 'calc')
    for d, _, files in sorted(os.walk(base)):
        for f in sorted(files):
            h.update(open(os.path.join(d, f), 'rb').read())
    return h.hexdigest()[:10]

def build(site, page, ld_json):
    """Write resources/index.html and resources/<slug>/index.html for every live calculator. Returns the URLs written."""
    v = version(site)
    out = os.path.join(site, 'resources')
    os.makedirs(out, exist_ok=True)
    canon = lambda path: f'<link rel="canonical" href="{ORIGIN}{path}">'
    hub_ld = {'@context': 'https://schema.org', '@graph': [
        {'@type': 'CollectionPage', '@id': ORIGIN + '/resources/', 'url': ORIGIN + '/resources/', 'name': HUB['title'],
         'description': HUB['desc'], 'inLanguage': 'en-US'},
        breadcrumbs([('GLOWDEGA®', '/'), ('Resources', '/resources/')]),
        {'@type': 'ItemList', 'itemListElement': [
            {'@type': 'ListItem', 'position': i + 1, 'url': f'{ORIGIN}/resources/{c["slug"]}/', 'name': c['name']}
            for i, c in enumerate(c for c in CALCS if c['live'])]}]}
    open(os.path.join(out, 'index.html'), 'w').write(page('../', HUB['title'], HUB['desc'],
        hub_main() + f'<script type="module" src="../assets/calc/hub.js?v={v}"></script>',
        canon('/resources/') + ld_json(hub_ld)))
    urls = ['/resources/']
    for c in CALCS:
        if not c['live']: continue
        p = PAGES[c['slug']]
        d = os.path.join(out, c['slug'])
        os.makedirs(d, exist_ok=True)
        main = calculator_main(c['slug'], p, f'../../assets/calc/calculators/{c["slug"]}.js?v={v}')
        open(os.path.join(d, 'index.html'), 'w').write(page('../../', p['title'], p['desc'], main,
            canon(f'/resources/{c["slug"]}/') + ld_json(calculator_ld(c['slug'], p))))
        urls.append(f'/resources/{c["slug"]}/')
    return urls
