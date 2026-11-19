// English names for the Serbian band plan (RATEL Tabela 1). Services use the
// ITU Radio Regulations terms; unknown applications return null (show the original).

// Latin <-> Cyrillic look-alikes mixed into words of the other script ("МSS", "сателитскa")
const LATIN_TO_CYRILLIC = { a: "а", e: "е", o: "о", c: "с", p: "р", x: "х", y: "у", k: "к", m: "м", t: "т", b: "в", h: "н", j: "ј" };
const CYRILLIC_TO_LATIN = Object.keys(LATIN_TO_CYRILLIC).reduce((result, latin) => {
	result[LATIN_TO_CYRILLIC[latin]] = latin;
	return result;
}, {});

// Longest first: replaced in this order on the lowercased name
const SERVICE_PHRASES = [
	["није намењено", "not allocated"],
	["мобилна-сателитска изузев поморске мобилне сателитске", "mobile-satellite except maritime mobile-satellite"],
	["мобилна изузев ваздухопловне мобилне", "mobile except aeronautical mobile"],
	["ваздухопловна мобилна-сателитска", "aeronautical mobile-satellite"],
	["ваздухопловна мобилна", "aeronautical mobile"],
	["ваздухопловна радионавигацијска", "aeronautical radionavigation"],
	["поморска мобилна-сателитска", "maritime mobile-satellite"],
	["поморска мобилна", "maritime mobile"],
	["поморска радионавигацијска", "maritime radionavigation"],
	["копнена мобилна", "land mobile"],
	["фиксна-сателитска", "fixed-satellite"],
	["мобилна-сателитска", "mobile-satellite"],
	["радионавигацијска-сателитска", "radionavigation-satellite"],
	["радиодифузна-сателитска", "broadcasting-satellite"],
	["аматерска-сателитска", "amateur-satellite"],
	["метеоролошка-сателитска", "meteorological-satellite"],
	["сателитска служба еталона фреквенције и сигнала тачног времена", "standard frequency and time signal-satellite"],
	["служба еталона фреквенције и сигнала тачног времена", "standard frequency and time signal"],
	["служба метеоролошких помоћних средстава", "meteorological aids"],
	["истраживање земље сателитом", "Earth exploration-satellite"],
	["истраживање свемира", "space research"],
	["операције у свемиру", "space operation"],
	["међусателитска", "inter-satellite"],
	["радиолокацијска", "radiolocation"],
	["радиоастрономска", "radio astronomy"],
	["радиодифузна", "broadcasting"],
	["радио-навигација", "radionavigation"],
	["радионавигацијска", "radionavigation"],
	["фиксна", "fixed"],
	["мобилна", "mobile"],
	["аматерска", "amateur"],
	["(опасност и позивање преко dsc)", "(distress and calling via DSC)"],
	["(опасност и позивање)", "(distress and calling)"],
	["(земља-свемир)", "(Earth-to-space)"],
	["(свемир-земља)", "(space-to-Earth)"],
	["(свемир-свемир)", "(space-to-space)"],
	["(земља-ваздухоплов)", "(ground-to-air)"],
	["(далеки свемир)", "(deep space)"],
	["(пасивно)", "(passive)"],
	["(активно)", "(active)"],
	["(радио-фарови)", "(radiobeacons)"],
	["(r)", "(R)"],
	["(or)", "(OR)"],
	["khz", "kHz"],
	["mhz", "MHz"]
];

// Applications ("Примена"), keyed by normalized name
const APPLICATIONS = {
	"радиодетерминацијске примене": "Radiodetermination applications",
	"радио-детерминацијске примене": "Radiodetermination applications",
	"радиодетерминацијска примена": "Radiodetermination applications",
	"индуктивна примена": "Inductive applications",
	"копнени системи": "Land systems",
	"копнени цивилни системи": "Civil land systems",
	"копнени и поморски системи": "Land and maritime systems",
	"поморски системи": "Maritime systems",
	"радио-астрономија": "Radio astronomy",
	"радио астрономија": "Radio astronomy",
	"фиксне везе": "Fixed links",
	"фиксне везе средњег и великог капацитета": "Medium and high capacity fixed links",
	"pmse": "PMSE (programme making and special events)",
	"поморски саобраћај": "Maritime traffic",
	"аматерска": "Amateur",
	"аматерска-сателитска": "Amateur-satellite",
	"мобилни системи": "Mobile systems",
	"мобини системи": "Mobile systems",
	"мобилни цивилни и војни системи": "Civil and military mobile systems",
	"радиолокацијске примене": "Radiolocation applications",
	"радиолокацијска примена": "Radiolocation applications",
	"радиолокацијски системи": "Radiolocation systems",
	"fss земаљске станице": "FSS earth stations",
	"fss земаљске станице-координиране": "FSS earth stations (coordinated)",
	"fss земаљске станице-некоординиране": "FSS earth stations (uncoordinated)",
	"fss земаљске станице-некоодниране": "FSS earth stations (uncoordinated)",
	"ваздухопловни системи": "Aeronautical systems",
	"вазхухопловни системи": "Aeronautical systems",
	"mss земаљске станице": "MSS earth stations",
	"пасивни сензори (сателитски)": "Passive sensors (satellite)",
	"пасивни сензори (сателит)": "Passive sensors (satellite)",
	"активни сензори (сателитски)": "Active sensors (satellite)",
	"ваздушни саобраћај": "Air traffic",
	"радари": "Radars",
	"радари - цивилни": "Civil radars",
	"радари мале снаге": "Low-power radars",
	"радари на ваздухопловима": "Airborne radars",
	"радари и навигациони системи": "Radars and navigation systems",
	"радари за мерење правца и брзине ветра": "Wind profiler radars",
	"примена на железници": "Railway applications",
	"mfcn": "MFCN (mobile networks)",
	"uwb": "UWB",
	"pmr/pamr": "PMR/PAMR (private mobile radio)",
	"pmr": "PMR (private mobile radio)",
	"pmr 446": "PMR446",
	"активни медицински импланти": "Active medical implants",
	"радио": "Radio broadcasting",
	"фиксни системи": "Fixed systems",
	"неспецифицирани srd уређаји": "Non-specific short-range devices",
	"радио-микрофони и помоћни слушни апарати": "Radio microphones and hearing aids",
	"радио-микрофони и помоћни слушни апарати апарати": "Radio microphones and hearing aids",
	"радио-микрофони и ald": "Radio microphones and assistive listening devices",
	"srr": "SRR (automotive short-range radar)",
	"истраживање свемира": "Space research",
	"функционални системи": "Functional systems (business radio)",
	"функионални системи": "Functional systems (business radio)",
	"спојне везе": "Feeder links",
	"истраживање земље сателитом": "Earth exploration-satellite",
	"сателитско истраживање земље": "Earth exploration-satellite",
	"сателитски системи": "Satellite systems",
	"ism": "ISM (industrial, scientific, medical)",
	"imt-2000 сателитска компонента": "IMT-2000 satellite component",
	"gso esomps": "GSO ESOMPs (earth stations on mobile platforms)",
	"ngso esomps": "NGSO ESOMPs (earth stations on mobile platforms)",
	"ppdr": "PPDR (public protection and disaster relief)",
	"bbdr": "BBDR (broadband disaster relief)",
	"ваздухопловни радио-фарови": "Aeronautical radiobeacons",
	"dsc": "DSC (digital selective calling)",
	"esv": "ESV (earth stations on vessels)",
	"fwa": "FWA (fixed wireless access)",
	"bfwa": "BFWA (broadband fixed wireless access)",
	"esim": "ESIM (earth stations in motion)",
	"ngso fss": "NGSO FSS",
	"hest, lest": "HEST, LEST (satellite terminals)",
	"широкопојасни системи за пренос података": "Wideband data transmission systems",
	"ваздухопловни навигациони системи": "Aeronautical navigation systems",
	"ваздухопловна навигација": "Aeronautical navigation",
	"aes": "AES (aircraft earth stations)",
	"метеоролошки радар": "Weather radar",
	"метеоролошки радари": "Weather radars",
	"метеролошки радари": "Weather radars",
	"радионавигацијски системи": "Radionavigation systems",
	"метеролошки сателити": "Weather satellites",
	"метеоролошки сателити": "Weather satellites",
	"метеоролошке радио сонде": "Radiosondes",
	"метеоролошка помоћна средства": "Meteorological aids",
	"mca": "MCA (mobile communications on aircraft)",
	"радио lans": "Radio LANs",
	"поморски радар": "Marine radar",
	"sar комуникације": "Search and rescue communications",
	"on site paging": "On-site paging",
	"on-site paging": "On-site paging",
	"пренос модулационог tv сигнала": "TV programme links",
	"једносмерни пренос радијског модулационог сигнала": "Radio programme links",
	"навигациони помоћни уређаји са доплеровим ефектом на ваздухоплову": "Airborne Doppler navigation aids",
	"ulp-wmce": "ULP-WMCE (wireless medical capsule endoscopy)",
	"glonass": "GLONASS",
	"galileo": "Galileo",
	"gps": "GPS",
	"its": "ITS (intelligent transport systems)",
	"sng": "SNG (satellite newsgathering)",
	"vsat": "VSAT",
	"ais": "AIS (ship identification)",
	"t-dab": "T-DAB (digital radio)",
	"t-dab+": "T-DAB+ (digital radio)",
	"rfid": "RFID",
	"frmcs": "FRMCS (future railway mobile)",
	"imt": "IMT (mobile networks)",
	"gsm": "GSM",
	"gsm-r": "GSM-R (railway)",
	"gsm 1800 / imt": "GSM 1800 / IMT",
	"gnss репетитори": "GNSS repeaters",
	"gnss pseudoliti": "GNSS pseudolites",
	"сателитски ваздухопловни системи": "Satellite aeronautical systems",
	"поморски радио-фарови": "Maritime radiobeacons",
	"navtex": "NAVTEX",
	"управљање моделима": "Model control",
	"телевизија": "Television",
	"ils": "ILS (instrument landing)",
	"dvb-t2": "DVB-T2 (digital TV)",
	"сателитски навигациони системи": "Satellite navigation systems",
	"wia": "WIA (wireless industrial applications)",
	"ttt": "TTT (transport and traffic telematics)",
	"synthetic aperture radar": "Synthetic aperture radar",
	"системи са индуктивном петљом за помоћ особама са оштећеним слухом": "Induction loops for the hearing impaired",
	"помагала за особе са оштећеним слухом": "Hearing aids",
	"системи за детекцију муња": "Lightning detection",
	"бежичне аудио/мултимедијалне примене": "Wireless audio / multimedia",
	"epirb-позив и опасност": "EPIRB (distress beacons)",
	"epirb-безбедност и опасност": "EPIRB (distress beacons)",
	"бродске станице": "Ship stations",
	"праћење, исцртавање путање и пренос података": "Tracking, tracing and data acquisition",
	"als": "ALS (avalanche beacons)",
	"dect": "DECT (cordless phones)",
	"cgc": "CGC (complementary ground component)",
	"тактички радио релејни системи": "Tactical radio relay",
	"тактички радио-релејни системи": "Tactical radio relay",
	"операције у свемиру": "Space operation",
	"радиодифузија (сателитска)": "Satellite broadcasting",
	"gbsar": "GBSAR (ground-based synthetic aperture radar)",
	"sit/sut": "SIT/SUT (satellite terminals)",
	"haps": "HAPS (high-altitude platforms)",
	"еталон фреквенције и тачног времена": "Standard frequency and time signal",
	"детекција ванредних догађаја": "Emergency detection",
	"грађани-cb": "Citizens band (CB)",
	"meteor-scater комуникације": "Meteor-scatter communications",
	"gbas": "GBAS (ground-based augmentation)",
	"vor": "VOR (navigation beacon)",
	"очитавање мерних уређаја": "Meter reading",
	"аларми": "Alarms",
	"mbans": "MBANS (medical body area networks)",
	"waic": "WAIC (wireless avionics)",
	"радио-висиномери": "Radio altimeters",
	"mls": "MLS (microwave landing)",
	"вадухопловна телеметрија": "Aeronautical telemetry",
	"ваздухопловна телеметрија": "Aeronautical telemetry"
};

// Who a use is reserved for, from its condition text
const USERS = [
	[/хитне интервенције/, "Emergency services"],
	[/МУП/, "Police (MUP)"],
	[/Војск|војн/, "Military"],
	[/БИА/, "Security agency (BIA)"],
	[/Све делатности/, "Anyone"]
];

const LICENSING = {
	"ПЗ": "Individual licence",
	"ЈН": "Licence by auction",
	"ПН": "Special purposes (state)",
	"ОО": "Licence-exempt"
};

const fixToken = (token) => {
	const latin = (token.match(/[a-z]/g) || []).length;
	const cyrillic = (token.match(/[а-џ]/g) || []).length;

	if (!latin || !cyrillic) {
		return token;
	}

	const table = cyrillic >= latin ? LATIN_TO_CYRILLIC : CYRILLIC_TO_LATIN;

	return token.replace(/./g, (char) => {
		return table[char] || char;
	});
};

// Lowercase, single spaces, look-alike letters in the word's own script
const normalize = (text) => {
	return String(text || "").toLowerCase().replace(/\s+/g, " ").trim().split(/([\s/-]+)/).map(fixToken).join("");
};

const service = (name) => {
	return SERVICE_PHRASES.reduce((result, phrase) => {
		return result.split(phrase[0]).join(phrase[1]);
	}, normalize(name));
};

const application = (name) => {
	return APPLICATIONS[normalize(name)] || null;
};

const users = (condition) => {
	return USERS.filter((rule) => {
		return rule[0].test(condition || "");
	}).map((rule) => {
		return rule[1];
	});
};

// "ПЗ/ЈН" -> ["Individual licence", "Licence by auction"]
const licensing = (code) => {
	return (code || "").split(/[\s/]+/).filter(Boolean).map((part) => {
		return LICENSING[part] || part;
	});
};

module.exports = {
	normalize: normalize,
	service: service,
	application: application,
	users: users,
	licensing: licensing
};
