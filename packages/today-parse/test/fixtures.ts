/**
 * 200 phrasings people actually type (spec 0002 AC1: ≥ 97% exact). Reference: Monday 16 Nov 2026, 09:30 in
 * Asia/Kolkata. Expectations are what a person means, written before looking at the parser's output.
 * `at` is local wall time "YYYY-MM-DD HH:MM"; `d` is a date without a time. Unlisted fields must be empty.
 */
export interface Expect {
  title: string;
  d?: string;
  at?: string;
  dur?: number;
  rrule?: string;
  p?: number;
  tags?: string[];
  project?: string;
  /** deadline (spec 0012) */
  dl?: string;
  notes?: string;
}
export const NOW = '2026-11-16T09:30:00+05:30';
export const PROJECTS = [
  { id: 'p-home', name: 'Home' },
  { id: 'p-work', name: 'Work' },
  { id: 'p-side', name: 'Side Project' },
];

export const CASES: [string, Expect][] = [
  // ---------------------------------------------------------------- plain titles (nothing to parse)
  ['buy milk', { title: 'Buy milk' }],
  ['call mom', { title: 'Call mom' }],
  ['iPhone screen repair', { title: 'iPhone screen repair' }],
  ['buy 2 kg rice', { title: 'Buy 2 kg rice' }],
  ['read chapter 5', { title: 'Read chapter 5' }],
  ['fix bug #123 in login', { title: 'Fix bug in login', tags: ['123'] }],
  ['email the 3 invoices', { title: 'Email the 3 invoices' }],
  ['SIP review', { title: 'SIP review' }],
  ['book 1BHK visit', { title: 'Book 1BHK visit' }],
  ['renew passport', { title: 'Renew passport' }],
  ['pay 500 to Ravi', { title: 'Pay 500 to Ravi' }],
  ['watch season 2', { title: 'Watch season 2' }],

  // ---------------------------------------------------------------- relative days
  ['call mom today', { title: 'Call mom', d: '2026-11-16' }],
  ['call mom tomorrow', { title: 'Call mom', d: '2026-11-17' }],
  ['tomorrow call mom', { title: 'Call mom', d: '2026-11-17' }],
  ['pay electricity bill tmrw', { title: 'Pay electricity bill', d: '2026-11-17' }],
  ['submit report day after tomorrow', { title: 'Submit report', d: '2026-11-18' }],
  ['groceries in 3 days', { title: 'Groceries', d: '2026-11-19' }],
  ['dentist follow-up in 2 weeks', { title: 'Dentist follow-up', d: '2026-11-30' }],
  ['plan trip next week', { title: 'Plan trip', d: '2026-11-23' }],
  ['clean balcony this weekend', { title: 'Clean balcony', d: '2026-11-21' }],
  ['file GST end of month', { title: 'File GST', d: '2026-11-30' }],
  ['review budget next month', { title: 'Review budget', d: '2026-12-01' }],
  ['send invoice in a week', { title: 'Send invoice', d: '2026-11-23' }],

  // ---------------------------------------------------------------- weekdays
  ['dentist fri', { title: 'Dentist', d: '2026-11-20' }],
  ['dentist on friday', { title: 'Dentist', d: '2026-11-20' }],
  ['team lunch thursday', { title: 'Team lunch', d: '2026-11-19' }],
  ['call bank monday', { title: 'Call bank', d: '2026-11-16' }],
  ['call bank next monday', { title: 'Call bank', d: '2026-11-23' }],
  ['standup prep tue', { title: 'Standup prep', d: '2026-11-17' }],
  ['laundry sat', { title: 'Laundry', d: '2026-11-21' }],
  ['meal prep sunday', { title: 'Meal prep', d: '2026-11-22' }],
  ['pay rent this friday', { title: 'Pay rent', d: '2026-11-20' }],
  ['gym next wednesday', { title: 'Gym', d: '2026-11-18' }],
  ['visit nani coming saturday', { title: 'Visit nani', d: '2026-11-21' }],
  ['by friday send the deck', { title: 'Send the deck', dl: '2026-11-20' }], // spec 0012: by = deadline

  // ---------------------------------------------------------------- dates (dd/mm, month names)
  ['pay rent 1 dec', { title: 'Pay rent', d: '2026-12-01' }],
  ['pay rent dec 1', { title: 'Pay rent', d: '2026-12-01' }],
  ['pay rent on 1st december', { title: 'Pay rent', d: '2026-12-01' }],
  ['tax filing 31/12', { title: 'Tax filing', d: '2026-12-31' }],
  ['renew insurance 05/01', { title: 'Renew insurance', d: '2027-01-05' }],
  ['birthday gift for Asha 3 jan', { title: 'Birthday gift for Asha', d: '2027-01-03' }],
  ['project kickoff 20 november', { title: 'Project kickoff', d: '2026-11-20' }],
  ['conference 15 feb 2027', { title: 'Conference', d: '2027-02-15' }],
  ['visa appointment on 2nd', { title: 'Visa appointment', d: '2026-12-02' }],
  ['parcel arrives on the 25th', { title: 'Parcel arrives', d: '2026-11-25' }],
  ['pay credit card bill 18th', { title: 'Pay credit card bill', d: '2026-11-18' }],
  ['diwali shopping 1 nov', { title: 'Diwali shopping', d: '2027-11-01' }],

  // ---------------------------------------------------------------- times
  ['call mom at 6pm', { title: 'Call mom', at: '2026-11-16 18:00' }],
  ['call mom 6pm', { title: 'Call mom', at: '2026-11-16 18:00' }],
  ['call mom at 6', { title: 'Call mom', at: '2026-11-16 18:00' }],
  ['standup at 10am', { title: 'Standup', at: '2026-11-16 10:00' }],
  ['standup 10:30', { title: 'Standup', at: '2026-11-16 10:30' }],
  ['breakfast with Raj at 8am', { title: 'Breakfast with Raj', at: '2026-11-17 08:00' }],
  ['take medicine 9pm', { title: 'Take medicine', at: '2026-11-16 21:00' }],
  ['submit timesheet at noon', { title: 'Submit timesheet', at: '2026-11-16 12:00' }],
  ['send report eod', { title: 'Send report', at: '2026-11-16 18:00' }],
  ['pack bags tonight', { title: 'Pack bags', at: '2026-11-16 21:00' }],
  ['call Priya at 7:15 pm', { title: 'Call Priya', at: '2026-11-16 19:15' }],
  ['wake up call 5:30am', { title: 'Wake up call', at: '2026-11-17 05:30' }],
  ['check oven at 9', { title: 'Check oven', at: '2026-11-16 21:00' }],
  ['meeting at 11', { title: 'Meeting', at: '2026-11-16 11:00' }],
  ['pay bills in the evening', { title: 'Pay bills', at: '2026-11-16 18:00' }],
  ['yoga in the morning', { title: 'Yoga', at: '2026-11-17 09:00' }],
  ['write journal at night', { title: 'Write journal', at: '2026-11-16 21:00' }],
  ['lunch with team afternoon', { title: 'Lunch with team', at: '2026-11-16 14:00' }],

  // ---------------------------------------------------------------- day + time
  ['dentist fri 11', { title: 'Dentist', at: '2026-11-20 11:00' }],
  ['dentist fri at 11am', { title: 'Dentist', at: '2026-11-20 11:00' }],
  ['dentist friday 11:30am', { title: 'Dentist', at: '2026-11-20 11:30' }],
  ['call mom tomorrow 6pm', { title: 'Call mom', at: '2026-11-17 18:00' }],
  ['tomorrow at 9am gym', { title: 'Gym', at: '2026-11-17 09:00' }],
  ['flight 3 dec 6:45am', { title: 'Flight', at: '2026-12-03 06:45' }],
  ['interview 24/11 at 3pm', { title: 'Interview', at: '2026-11-24 15:00' }],
  ['review PR monday 4pm', { title: 'Review PR', at: '2026-11-16 16:00' }],
  ['parents arrive next sunday 8pm', { title: 'Parents arrive', at: '2026-11-22 20:00' }], // same rule as "next wednesday": the coming one
  ['call landlord tomorrow morning', { title: 'Call landlord', at: '2026-11-17 09:00' }],
  ['movie saturday evening', { title: 'Movie', at: '2026-11-21 18:00' }],
  ['pick up dry cleaning tomorrow evening at 7', { title: 'Pick up dry cleaning', at: '2026-11-17 19:00' }],
  ['doctor thursday at 5', { title: 'Doctor', at: '2026-11-19 17:00' }],
  ['bank visit today 3pm', { title: 'Bank visit', at: '2026-11-16 15:00' }],
  ['call CA on 2 dec at 11am', { title: 'Call CA', at: '2026-12-02 11:00' }],
  ['team dinner fri night', { title: 'Team dinner', at: '2026-11-20 21:00' }],

  // ---------------------------------------------------------------- durations
  ['dentist fri 11 for 45m', { title: 'Dentist', at: '2026-11-20 11:00', dur: 45 }],
  ['deep work 2pm for 2 hours', { title: 'Deep work', at: '2026-11-16 14:00', dur: 120 }],
  ['gym tomorrow 7am for 1h', { title: 'Gym', at: '2026-11-17 07:00', dur: 60 }],
  ['call with Neha at 4 for 30 min', { title: 'Call with Neha', at: '2026-11-16 16:00', dur: 30 }],
  ['read 30m', { title: 'Read', dur: 30 }],
  ['write blog post 1h30m', { title: 'Write blog post', dur: 90 }],
  ['walk for half an hour', { title: 'Walk', dur: 30 }],
  ['meditate for 15 minutes', { title: 'Meditate', dur: 15 }],
  ['planning session for an hour friday', { title: 'Planning session', d: '2026-11-20', dur: 60 }],
  ['study for 1.5 hours tonight', { title: 'Study', at: '2026-11-16 21:00', dur: 90 }],
  ['call dad in 2 hours', { title: 'Call dad', at: '2026-11-16 11:30' }],
  ['taxes 90min', { title: 'Taxes', dur: 90 }],

  // ---------------------------------------------------------------- repeats
  ['pay rent every 1st', { title: 'Pay rent', d: '2026-12-01', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1' }],
  [
    'pay rent every 1st of the month',
    { title: 'Pay rent', d: '2026-12-01', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1' },
  ],
  [
    'pay rent on the 1st of every month',
    { title: 'Pay rent', d: '2026-12-01', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1' },
  ],
  ['SIP every 5th', { title: 'SIP', d: '2026-12-05', rrule: 'FREQ=MONTHLY;BYMONTHDAY=5' }],
  [
    'credit card bill every 20th',
    { title: 'Credit card bill', d: '2026-11-20', rrule: 'FREQ=MONTHLY;BYMONTHDAY=20' },
  ],
  [
    'salary check every last day of the month',
    { title: 'Salary check', d: '2026-11-30', rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1' },
  ],
  ['water plants every day', { title: 'Water plants', d: '2026-11-16', rrule: 'FREQ=DAILY' }],
  ['water plants daily at 8am', { title: 'Water plants', at: '2026-11-17 08:00', rrule: 'FREQ=DAILY' }],
  ['vitamins every day 9pm', { title: 'Vitamins', at: '2026-11-16 21:00', rrule: 'FREQ=DAILY' }],
  [
    'standup every weekday at 10',
    { title: 'Standup', at: '2026-11-16 10:00', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  ],
  [
    'standup weekdays 10am',
    { title: 'Standup', at: '2026-11-16 10:00', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  ],
  ['laundry every saturday', { title: 'Laundry', d: '2026-11-21', rrule: 'FREQ=WEEKLY;BYDAY=SA' }],
  [
    'gym every mon, wed and fri at 7am',
    { title: 'Gym', at: '2026-11-18 07:00', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' },
  ],
  [
    'team sync every tuesday 3pm',
    { title: 'Team sync', at: '2026-11-17 15:00', rrule: 'FREQ=WEEKLY;BYDAY=TU' },
  ],
  [
    'weekly review every sunday evening',
    { title: 'Weekly review', at: '2026-11-22 18:00', rrule: 'FREQ=WEEKLY;BYDAY=SU' },
  ],
  ['clean fridge every 2 weeks', { title: 'Clean fridge', d: '2026-11-16', rrule: 'FREQ=WEEKLY;INTERVAL=2' }],
  ['haircut every other month', { title: 'Haircut', d: '2026-11-16', rrule: 'FREQ=MONTHLY;INTERVAL=2' }],
  ['backup photos monthly', { title: 'Backup photos', d: '2026-11-16', rrule: 'FREQ=MONTHLY;BYMONTHDAY=16' }],
  ['call grandma weekly', { title: 'Call grandma', d: '2026-11-16', rrule: 'FREQ=WEEKLY;BYDAY=MO' }],
  [
    'mom birthday every 14 march',
    { title: 'Mom birthday', d: '2027-03-14', rrule: 'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=14' },
  ],
  [
    'anniversary every dec 12',
    { title: 'Anniversary', d: '2026-12-12', rrule: 'FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=12' },
  ],
  ['car service every year', { title: 'Car service', d: '2026-11-16', rrule: 'FREQ=YEARLY' }],
  ['pay maid every month', { title: 'Pay maid', d: '2026-11-16', rrule: 'FREQ=MONTHLY;BYMONTHDAY=16' }],
  [
    'meditation every weekend morning',
    { title: 'Meditation', at: '2026-11-21 09:00', rrule: 'FREQ=WEEKLY;BYDAY=SA,SU' },
  ],
  [
    'bin day every thursday night',
    { title: 'Bin day', at: '2026-11-19 21:00', rrule: 'FREQ=WEEKLY;BYDAY=TH' },
  ],

  // ---------------------------------------------------------------- Hinglish
  ['kal mummy ko call karna', { title: 'Mummy ko call karna', d: '2026-11-17' }],
  ['mummy ko call kal', { title: 'Mummy ko call', d: '2026-11-17' }],
  ['aaj bijli ka bill bharna', { title: 'Bijli ka bill bharna', d: '2026-11-16' }],
  ['parso doctor', { title: 'Doctor', d: '2026-11-18' }],
  ['kal shaam 6 baje call mom', { title: 'Call mom', at: '2026-11-17 18:00' }],
  ['kal subah 7 baje gym', { title: 'Gym', at: '2026-11-17 07:00' }],
  ['aaj raat 10 baje movie', { title: 'Movie', at: '2026-11-16 22:00' }],
  ['dopahar 2 baje meeting', { title: 'Meeting', at: '2026-11-16 14:00' }],
  ['5 baje chai', { title: 'Chai', at: '2026-11-16 17:00' }],
  ['sham ko sabzi lana', { title: 'Sabzi lana', at: '2026-11-16 18:00' }],
  ['raat ko dawai', { title: 'Dawai', at: '2026-11-16 21:00' }],
  ['subah walk', { title: 'Walk', at: '2026-11-17 09:00' }],
  ['shukravar ko rent', { title: 'Rent', d: '2026-11-20' }],
  ['somvar meeting', { title: 'Meeting', d: '2026-11-16' }],
  ['agle hafte trip plan', { title: 'Trip plan', d: '2026-11-23' }],
  ['har roz paani do plants ko', { title: 'Paani do plants ko', d: '2026-11-16', rrule: 'FREQ=DAILY' }],
  ['har somvaar standup', { title: 'Standup', d: '2026-11-16', rrule: 'FREQ=WEEKLY;BYDAY=MO' }],
  ['har mahine rent', { title: 'Rent', d: '2026-11-16', rrule: 'FREQ=MONTHLY;BYMONTHDAY=16' }],
  ['kal 11 baje dentist', { title: 'Dentist', at: '2026-11-17 11:00' }],
  ['parso raat 9:30 baje train', { title: 'Train', at: '2026-11-18 21:30' }],
  ['budhvar shaam 7 baje class', { title: 'Class', at: '2026-11-18 19:00' }],
  ['kal tak report bhejna', { title: 'Report bhejna', d: '2026-11-17' }],
  ['aaj sham gym', { title: 'Gym', at: '2026-11-16 18:00' }],
  ['rozana yoga subah 6 baje', { title: 'Yoga', at: '2026-11-17 06:00', rrule: 'FREQ=DAILY' }],

  // ---------------------------------------------------------------- priority, tags, projects
  ['pay rent !!', { title: 'Pay rent', p: 2 }],
  ['pay rent !!!', { title: 'Pay rent', p: 3 }],
  ['call bank !', { title: 'Call bank', p: 1 }],
  ['file taxes p1', { title: 'File taxes', p: 3 }],
  ['file taxes p2 tomorrow', { title: 'File taxes', d: '2026-11-17', p: 2 }],
  ['update resume p3', { title: 'Update resume', p: 1 }],
  ['tidy desk p4', { title: 'Tidy desk', p: 0 }],
  ['renew licence high priority', { title: 'Renew licence', p: 3 }],
  ['sort photos low priority', { title: 'Sort photos', p: 1 }],
  ['buy curtains #home', { title: 'Buy curtains', tags: ['home'] }],
  ['buy curtains #home #shopping', { title: 'Buy curtains', tags: ['home', 'shopping'] }],
  ['fix leaking tap @Home', { title: 'Fix leaking tap', project: 'p-home' }],
  ['prepare slides @work fri', { title: 'Prepare slides', d: '2026-11-20', project: 'p-work' }],
  ['ship v2 @side-project !!', { title: 'Ship v2', p: 2, project: 'p-side' }],
  [
    'email Ravi @work tomorrow 10am #followup p1',
    { title: 'Email Ravi', at: '2026-11-17 10:00', p: 3, tags: ['followup'], project: 'p-work' },
  ],
  [
    'quarterly review #work every 1st 11am',
    { title: 'Quarterly review', at: '2026-12-01 11:00', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', tags: ['work'] },
  ],

  // ---------------------------------------------------------------- noise, punctuation, filler
  ['remind me to call mom tomorrow', { title: 'Call mom', d: '2026-11-17' }],
  ['Remind me to pay rent on 1 Dec', { title: 'Pay rent', d: '2026-12-01' }],
  ['todo: renew passport next week', { title: 'Renew passport', d: '2026-11-23' }],
  ['call mom, tomorrow', { title: 'Call mom', d: '2026-11-17' }],
  ['tomorrow - call mom', { title: 'Call mom', d: '2026-11-17' }],
  ['Call Mom Tomorrow 6PM', { title: 'Call Mom', at: '2026-11-17 18:00' }],
  ['  buy   eggs   tomorrow  ', { title: 'Buy eggs', d: '2026-11-17' }],
  ['buy milk.', { title: 'Buy milk.' }],
  ['send deck to Anil by tomorrow', { title: 'Send deck to Anil', dl: '2026-11-17' }],
  ['submit form before friday', { title: 'Submit form', dl: '2026-11-20' }],
  ['meet Sam at Starbucks at 5', { title: 'Meet Sam at Starbucks', at: '2026-11-16 17:00' }],
  ['book tickets for Friday show', { title: 'Book tickets for show', d: '2026-11-20' }],
  ['dinner at 8 with family', { title: 'Dinner with family', at: '2026-11-16 20:00' }],
  ['call at 6 to confirm', { title: 'Call to confirm', at: '2026-11-16 18:00' }],

  // ---------------------------------------------------------------- times that already passed today
  ['standup at 9am', { title: 'Standup', at: '2026-11-17 09:00' }],
  ['coffee 8:30', { title: 'Coffee', at: '2026-11-17 08:30' }],
  ['alarm 6am', { title: 'Alarm', at: '2026-11-17 06:00' }],
  ['daily standup at 9', { title: 'Daily standup', at: '2026-11-16 21:00' }],
  ['email at 9:30', { title: 'Email', at: '2026-11-17 09:30' }],

  // ---------------------------------------------------------------- mixed and longer sentences
  [
    'call the plumber about the kitchen sink tomorrow at 10',
    { title: 'Call the plumber about the kitchen sink', at: '2026-11-17 10:00' },
  ],
  [
    'send Q3 numbers to finance on friday before 5pm',
    { title: 'Send Q3 numbers to finance before', at: '2026-11-20 17:00' },
  ],
  ['pay school fees for Aarav on 10 dec', { title: 'Pay school fees for Aarav', d: '2026-12-10' }],
  ['order cake for 3rd birthday party sat', { title: 'Order cake for 3rd birthday party', d: '2026-11-21' }],
  ['renew domain dubey.app before 5 jan', { title: 'Renew domain dubey.app', dl: '2027-01-05' }],
  ['book cab for airport tomorrow 4am', { title: 'Book cab for airport', at: '2026-11-17 04:00' }],
  ['ask HR about leave policy next week', { title: 'Ask HR about leave policy', d: '2026-11-23' }],
  ['upload 2 docs to portal today', { title: 'Upload 2 docs to portal', d: '2026-11-16' }],
  [
    'research mutual funds this weekend for 2h',
    { title: 'Research mutual funds', d: '2026-11-21', dur: 120 },
  ],
  ['pay property tax by 31 march', { title: 'Pay property tax', dl: '2027-03-31' }],
  [
    'prepare for interview thursday 2pm for 1h #career',
    { title: 'Prepare for interview', at: '2026-11-19 14:00', dur: 60, tags: ['career'] },
  ],
  ['groceries: atta, dal, rice tomorrow', { title: 'Groceries: atta, dal, rice', d: '2026-11-17' }],
  ['respond to Meera re: venue tonight', { title: 'Respond to Meera re: venue', at: '2026-11-16 21:00' }],
  ['top up metro card in 2 days', { title: 'Top up metro card', d: '2026-11-18' }],
  ['check PF balance next month', { title: 'Check PF balance', d: '2026-12-01' }],
  ['service AC before summer', { title: 'Service AC before summer' }],
  ['team offsite 12 dec for 8 hours', { title: 'Team offsite', d: '2026-12-12', dur: 480 }],
  ['call insurance agent wed 12:30pm', { title: 'Call insurance agent', at: '2026-11-18 12:30' }],
  [
    'mail rent receipt every 1st 10am @home',
    {
      title: 'Mail rent receipt',
      at: '2026-12-01 10:00',
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=1',
      project: 'p-home',
    },
  ],
  [
    'pickup kids every weekday 3:30pm',
    { title: 'Pickup kids', at: '2026-11-16 15:30', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  ],
  ['night shift sunday 11pm', { title: 'Night shift', at: '2026-11-22 23:00' }],
  ['midnight launch fri', { title: 'Launch', at: '2026-11-20 23:59' }],
  ['pay rent on 1st', { title: 'Pay rent', d: '2026-12-01' }],
  ['meeting 17/11 10:00', { title: 'Meeting', at: '2026-11-17 10:00' }],
  ['exam on 7th jan at 9am', { title: 'Exam', at: '2027-01-07 09:00' }],
  ['dentist 2pm friday for 45 mins', { title: 'Dentist', at: '2026-11-20 14:00', dur: 45 }],
  ['call back in a week', { title: 'Call back', d: '2026-11-23' }],
];
