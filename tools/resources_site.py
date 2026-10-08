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
# The default (esthetician) example service; the page swaps it for the chosen profession's.
SIG = '<span data-prof="signature">90-minute peel</span>'

esc = lambda s: html.escape(str(s), quote=True)

# ---------- the ten calculators (hub cards). live=False: Sprint 2, shown as "Coming soon" with no link ----------
CALCS = [
    dict(slug='service-pricing', cat='Pricing', live=True, name='Service Pricing Calculator', audiences='solo owner',
         desc='Find a price that covers your costs, values your time, and supports your goals.', cta='Calculate Your Price',
         desc_employee='Prices set by the salon or spa? Use What Is Your Time Worth? to see what your hours need to earn.'),
    dict(slug='hourly-rate', cat='Pricing', live=True, name='What Is Your Time Worth?', audiences='solo employee owner',
         desc='Work out what every client hour needs to bring in to reach the income you want.', cta='Find Your Hourly Rate',
         desc_employee='See what each client hour needs to earn you to reach your take-home goal.'),
    dict(slug='service-cost', cat='Pricing', live=True, name='Cost Per Service Calculator', audiences='solo employee owner',
         desc='Add up the products and supplies behind a facial, peel or lash fill, down to the gloves.', cta='Count Your Costs'),
    dict(slug='service-profitability', cat='Profitability', live=True, name='Service Profitability Calculator', audiences='solo owner',
         desc='See what a single service really earns, per appointment and per hour.', cta='Check a Service'),
    dict(slug='break-even', cat='Profitability', live=True, name='Break-Even Calculator', audiences='solo owner',
         desc='Find how many appointments a month cover your rent and other fixed costs.', cta='Find Your Break-Even'),
    dict(slug='profit-take-home', cat='Profitability', live=False, name='Profit & Take-Home Calculator', audiences='solo employee owner',
         desc='Separate business profit from what you actually take home.',
         desc_employee='Estimate your take-home pay from commission, wages, tips and bonuses.'),
    dict(slug='menu-profitability', cat='Profitability', live=False, name='Service Menu Profitability Analyzer', audiences='solo owner',
         desc='Rank every service on your menu by profit, margin and profit per hour.'),
    dict(slug='capacity-clients', cat='Growth', live=False, name='Capacity & Clients Calculator', audiences='solo employee owner',
         desc='See how many clients a month your revenue goal really takes.'),
    dict(slug='price-increase', cat='Growth', live=False, name='Price Increase Calculator', audiences='solo owner',
         desc='See what a price increase is worth, and how many clients you could lose and still come out even.'),
    dict(slug='discount-promotion', cat='Promotions', live=False, name='Discount & Promotion Calculator', audiences='solo owner',
         desc='Find out what a discount really costs before you run the promo.'),
]
CATEGORIES = ['Pricing', 'Profitability', 'Growth', 'Promotions']
MORE = ['Pricing Guides', 'Business Templates', 'Marketing Tools']

# ---------- field helpers ----------
def F(key, label, unit, name, required=False, min_exclusive=False, max=None, max_exclusive=False, placeholder='',
      value='', hint='', types=None, labels=None, min=None, min_message='', when=''):
    return dict(key=key, label=label, unit=unit, name=name, required=required, min_exclusive=min_exclusive, max=max,
                max_exclusive=max_exclusive, placeholder=placeholder, value=value, hint=hint, types=types, labels=labels or {},
                min=min, min_message=min_message, when=when)

def CHOICE(key, legend, options, types=None, value=None):
    """A radio group other fields can depend on (F(..., when='key:value other')). options: [(value, label)]."""
    return dict(kind='choice', key=key, legend=legend, options=options, types=types, value=value or options[0][0])

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
def OWNER_PAY():
    return F('ownerPay', 'Your monthly owner pay', 'money', 'your monthly owner pay', max=MONEY_MAX, placeholder='5,000',
             hint='What you pay yourself each month. Leave blank if it is already in payroll.', types=['owner'])
def COMMISSION(hint='The share of each service price paid to the provider.'):
    return PCT('commissionRate', 'Commission paid per service (%)', 'a commission', placeholder='40', hint=hint, types=['owner'])
def WAGE(hint='What you pay the provider per hour. Leave blank if they are paid on commission only.'):
    return F('providerWage', 'Provider’s hourly wage', 'money', 'an hourly wage', max=MONEY_MAX, placeholder='20', hint=hint, types=['owner'])
def PAY_PER_HOUR(required=False, hint='What an hour of your time should pay you, before tax. This is your labor cost.'):
    return F('targetHourly', 'Your pay per hour', 'money', 'your pay per hour', required=required, max=MONEY_MAX, placeholder='45',
             hint=hint, types=['solo'])

MONEY_MAX = 10_000_000
AFFIX = {'money': ('$', ''), 'percent': ('', '%'), 'minutes': ('', 'min'), 'hours': ('', 'hrs'), 'number': ('', '')}

PAGES = {
    'service-pricing': dict(
        title='Beauty Service Pricing Calculator | GLOWDEGA', h1='Beauty Service Pricing Calculator',
        desc='Calculate what to charge for facials, peels, brows, lashes and hair services, based on your costs, time, '
             'expenses and desired earnings. Free, no sign-up.',
        intro=['Most beauty pros set prices by looking at the studio down the street. That number knows nothing about your rent, your product costs, or how long your signature service really takes. This calculator works from your numbers instead, and gives you a recommended price and range for a single service.',
               'Solo providers, such as a lash artist booking 90-minute full sets or a nail technician with a full book of gel manicures, enter the service length, what products and supplies cost each time, their monthly rent and what an hour of their time should pay them. Owners enter the provider’s hourly wage and any commission instead, so labor is priced the way it is really paid. Rent is shared by the hour: a 90-minute facial in a $2,000-a-month suite, worked 160 hours a month, carries $18.75 of rent. Under “Customize your calculation” you can add other expenses, card fees and admin time.',
               'Every recommended price keeps a profit margin of at least 30%, so the business earns something after costs and pay. The result shows the lowest price that covers your costs (break-even), the recommended price that also pays labor and margin, and how your current price compares. Treat it as a starting point: local demand, your experience and your results still matter.'],
        types=['solo', 'employee', 'owner'], unsupported=['employee'],
        type_notes={'employee': 'Service prices are usually set by the business you work for. To see what your own time '
                    'needs to earn, use <a href="../hourly-rate/?type=employee">What Is Your Time Worth?</a> A Profit &amp; '
                    'Take-Home calculator for employees is coming soon.'},
        basic=[F('currentPrice', 'Current service price', 'money', 'a current price', max=MONEY_MAX, placeholder='95',
                 hint='Leave blank for a new service.'),
               F('durationMinutes', 'Service duration', 'minutes', 'a service duration', required=True, min_exclusive=True,
                 max=1440, placeholder='60', hint=f'Including set-up and consultation time. For a {SIG}, enter <span data-prof="signature-minutes">90</span>.'),
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
               'Solo providers and owners see the revenue needed each year, each month, per working hour and per client hour, plus what a 90-minute color service or a 60-minute facial should bring in. Employees see the hourly wage, or the monthly, weekly and per-client-hour service sales, that reach their take-home pay goal. The tax rate is a rough estimate, not tax advice.'],
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
                    min_exclusive=True, max=1440, value='90', hint=f'Used for the “a service like this should bring in” line, such as a {SIG}.')],
        crumb_cat='Pricing'),
    'service-cost': dict(
        title='Cost Per Service Calculator for Beauty Pros | GLOWDEGA', h1='Cost Per Service Calculator',
        desc='Add up the true product and supply cost of a facial, peel, lash fill, brow lamination or color service, '
             'line by line, then use it to price the service.',
        intro=['A gel manicure looks cheap to deliver until you count everything that goes into it: base coat, color, top coat, cuticle oil, files, buffers and lint-free wipes. A chemical peel or a root touch-up tells the same story. Small costs add up, and they come out of every single appointment.',
               'This calculator is for anyone who performs services: estheticians, hairstylists, nail technicians, lash and brow artists, barbers and owners costing a menu. Add one line per item. Choose whether it is a product (enzyme mask, lash adhesive, color, developer), a supply (gloves, cotton, foils, applicators) or another consumable (laundry, single-use linens), then enter how much one service uses and what that amount costs. Solo providers and owners can add the service length, monthly rent and labor too: a 90-minute facial in a $2,000-a-month room worked 160 hours a month carries $18.75 of rent.',
               'You get the product cost, supply cost, rent share, labor and the true cost per service. Send them straight into the Service Pricing Calculator to find a price that covers them, plus profit.'],
        types=['solo', 'employee', 'owner'], unsupported=[],
        type_notes={'employee': 'Rent is paid by the business you work for, so only products and supplies are counted.'},
        basic=[F('durationMinutes', 'Service duration', 'minutes', 'a service duration', max=1440, placeholder='90',
                 hint=f'Including set-up and consultation, e.g. <span data-prof="signature-minutes">90</span> for a {SIG}. Needed to share rent and labor by time.', types=['solo', 'owner']),
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
        intro=['Two services can bring in the same price and earn very different amounts. A 90-minute signature facial and a 60-minute brow lamination might both be on your menu at $120, but one uses more room time and far more product. This calculator shows what a single service earns once its costs, labor included, are paid.',
               'It is built for solo providers checking their own menu, from lash fills to cut-and-color appointments, and for owners whose services are performed by staff on wages or commission. Enter the price, how long the service takes, what the products and supplies cost, your monthly rent, which each service carries by the hour, and the labor: your own pay per hour if you work solo, or the provider’s hourly wage and commission if you own the business. Under “Customize your calculation” you can add other overhead, card processing and a target profit per hour.',
               'The result shows revenue, total cost, labor, profit or loss per appointment, profit margin, and profit and revenue per hour. If the service falls short, the Service Pricing Calculator works out a price that fixes it. Results are estimates to inform your decisions, not financial advice.'],
        types=['solo', 'employee', 'owner'], unsupported=['employee'],
        type_notes={'employee': 'Service profit belongs to the business you work for. To see what your own time needs to '
                    'earn, use <a href="../hourly-rate/?type=employee">What Is Your Time Worth?</a>'},
        basic=[F('price', 'Service price', 'money', 'a service price', required=True, min_exclusive=True, max=MONEY_MAX, placeholder='120'),
               F('durationMinutes', 'Service duration', 'minutes', 'a service duration', required=True, min_exclusive=True,
                 max=1440, placeholder='90', hint=f'For a {SIG}, enter <span data-prof="signature-minutes">90</span>.'),
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
}

# ---------- rendering ----------
def choice_html(c):
    types = f' data-types="{" ".join(c["types"])}"' if c['types'] else ''
    return (f'<fieldset class="calc-type calc-choice"{types}><legend>{esc(c["legend"])}</legend><div class="calc-type__options">'
            + ''.join(f'<label><input type="radio" name="{c["key"]}" value="{v}"{" checked" if v == c["value"] else ""}><span>{esc(l)}</span></label>'
                      for v, l in c['options'])
            + '</div></fieldset>')

def field_html(f):
    if f.get('kind') == 'choice': return choice_html(f)
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
                 + ''.join(f'<div class="calc-type-note" data-for-type="{t}" hidden><p>{n}</p></div>' for t, n in p['type_notes'].items()))
    # profession: wording only (example services in hints and results); pre-set from ?profession= or the hub choice
    types += ('<div class="calc-profession"><label for="f-profession">Your license</label><select id="f-profession" name="profession">'
              + ''.join(f'<option value="{k}"{" selected" if k == PROFESSIONS[0][0] else ""}>{esc(l)}</option>' for k, l in PROFESSIONS)
              + '</select><p class="calc-hint">Changes the example services in the wording only. The math is the same for every license.</p></div>')
    rows = ''
    if p.get('rows'):
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
    data = f' data-audiences="{c["audiences"]}"' + (f' data-desc-employee="{esc(c["desc_employee"])}"' if c.get('desc_employee') else '')
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
            'numbers, and grow your business.</p><p class="hub-sub">Built for estheticians, lash and brow artists, hairstylists, nail '
            'techs and studio owners. No sign-up; your numbers stay in your browser.</p>'
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
           desc='Free calculators for beauty professionals: price your services, find your hourly rate, cost each service, '
                'check profitability and find your break-even point.')

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
