# Kapsa: jak ji zprovoznit

Kapsa je webová aplikace, kterou si nainstaluješ na plochu iPhonu i počítače. Data jsou v databázi Supabase, takže vidíš totéž na obou zařízeních. Hosting i databáze jsou zdarma. Celé nastavení zabere asi 30 minut a děláš ho jednou.

Než začneš, můžeš si aplikaci vyzkoušet bez databáze: otevři `index.html` přes jakýkoli lokální server (třeba `python3 -m http.server` ve složce projektu) a přidej na konec adresy `?demo`. Naplní se vymyšlenými daty, která zůstanou jen v prohlížeči.

## 1. Databáze v Supabase

1. Založ si účet na supabase.com a vytvoř nový projekt. Region zvol Frankfurt (eu-central), heslo k databázi si ulož, ale v aplikaci ho potřebovat nebudeš.
2. V levém menu otevři **SQL Editor**, dej **New query**, vlož celý obsah souboru `supabase/schema.sql` a spusť tlačítkem **Run**. Skript vytvoří tabulky, zabezpečení a funkci pro zápis plateb z Apple Pay.
3. Otevři **Authentication → Users → Add user → Create new user**. Zadej svůj e-mail a heslo a zaškrtni automatické potvrzení (Auto Confirm User). Tímhle účtem se budeš do Kapsy přihlašovat.
4. V **Authentication → Sign In / Providers** vypni **Allow new users to sign up**. Nikdo další si pak účet nezaloží.
5. V **Project Settings → API Keys** (u starších projektů **Settings → API**) si zkopíruj:
   - **Project URL** (vypadá jako `https://abcdefgh.supabase.co`),
   - **Publishable key** (začíná `sb_publishable_`), případně starší **anon public** klíč.

Tyto dvě hodnoty vlož do souboru `js/config.js` místo vzorových.

Oba údaje jsou veřejné z principu: bez přihlášení přes ně nikdo tvoje data nepřečte, to hlídá zabezpečení v databázi. Nikdy ale nikam nedávej **secret** ani **service_role** klíč.

Bezplatný tarif Supabase stačí na desítky let plateb. Projekt se uspí, pokud ho týden nikdo nepoužije; při denním používání se to nestane, a kdyby ano, v administraci ho jedním kliknutím probudíš.

## 2. Zveřejnění na GitHub Pages

1. Založ si účet na github.com a vytvoř nový repozitář, třeba `kapsa`. GitHub Pages zdarma vyžaduje veřejný repozitář; v kódu nic tajného není, přihlášení a data jsou v Supabase.
2. Na stránce repozitáře zvol **Add file → Upload files** a přetáhni tam celý obsah složky projektu (včetně podsložek `css`, `js`, `icons`, `supabase`). Potvrď **Commit changes**.
3. V **Settings → Pages** nastav **Source: Deploy from a branch**, větev `main` a složku `/ (root)`. Ulož.
4. Za minutu až dvě poběží aplikace na adrese `https://tvoje-jmeno.github.io/kapsa/`.

Chceš soukromý repozitář? Stejně zdarma to jde přes Cloudflare Pages (propojíš repozitář a nastavíš výstupní složku na kořen projektu, žádný build příkaz).

## 3. Instalace

**iPhone:** otevři adresu v Safari, ťukni na Sdílet a zvol **Přidat na plochu**. Kapsu pak spouštěj z ikony na ploše a jednou se v ní přihlas. Aplikace z plochy má vlastní úložiště, takže přihlášení ze Safari se nepřenáší.

**Počítač:** otevři adresu v Chrome nebo Edge a v adresním řádku klikni na ikonu instalace. V Safari na Macu zvol Soubor → Přidat do Docku.

## 4. Automatický zápis plateb z Apple Pay

Tohle je část, díky které nemusíš nic opisovat. Po každé platbě telefonem nebo hodinkami iPhone pošle částku a obchodníka do Kapsy. Potřebuješ iOS 17 nebo novější.

Údaje, které budeš vkládat, najdeš v Kapse v **Nastavení → Platby z Apple Pay**. Každý má tlačítko na zkopírování, takže je nejjednodušší dělat Zkratku přímo v iPhonu.

1. Otevři aplikaci **Zkratky**, dole záložku **Automatizace** a ťukni na **+**.
2. Vyber **Transakce**. Zvol karty, které chceš sledovat (osobní i firemní), kategorie obchodníků nech všechny. Zaškrtni **Spustit okamžitě** (jinak by se tě iPhone pokaždé ptal) a pokračuj **Další**.
3. Zvol **Nová prázdná automatizace** a přidej akci **Získat obsah URL**.
   - Do pole URL vlož **Adresu** z Kapsy.
   - Rozbal šipku u akce. **Metoda:** POST.
   - **Hlavičky:** přidej hlavičku s názvem `apikey` a hodnotou **apikey** z Kapsy.
   - **Tělo požadavku:** JSON. Přidej tři textová pole:
     - `p_token` s hodnotou **p_token** z Kapsy,
     - `p_amount` s proměnnou **Částka** (ťukni do hodnoty, vyber Vstup zkratky a vlastnost Částka),
     - `p_merchant` s proměnnou **Obchodník** (stejně jako u částky),
     - `p_card` s proměnnou **Karta nebo propustka**. Podle ní Kapsa pozná, z jakého účtu se platilo.
4. Volitelně přidej akci **Získat hodnotu slovníku**: hodnota pro klíč `zprava` ve slovníku **Obsah URL**. Za ni přidej **Zobrazit oznámení** s textem **Hodnota slovníku**. Po každé platbě pak uvidíš třeba „Potraviny: zbývá 2 880 Kč z 4 475 Kč. Dnes ještě 412 Kč.“ a při blížícím se limitu varování.
5. Ulož. Při příští platbě se v Kapse objeví položka v sekci **Ke kontrole** s navrženou kategorií.

Názvy akcí se mohou v různých verzích iOS mírně lišit; v angličtině jde o Transaction, Get Contents of URL, Get Dictionary Value a Show Notification.

Pár věcí, které je dobré vědět:

- Automatizace se spouští při přiložení telefonu, ještě než banka platbu potvrdí. Když platba neprojde, v Kapse ji smažeš tlačítkem „Platba neproběhla? Smazat“.
- Platby plastovou kartou, převody a inkasa Zkratka nezachytí. Na ty je import výpisu nebo ruční zápis.
- U plateb v cizí měně Kapsa uloží původní částku s poznámkou a ty doplníš korunovou.
- Pokud používáš starší anon klíč (začíná `eyJ`) a Zkratka hlásí chybu oprávnění, přidej ještě hlavičku `Authorization` s hodnotou `Bearer ` a za mezerou stejný klíč.
- Osobní klíč (`p_token`) můžeš v Nastavení kdykoli vygenerovat znovu. Starý tím přestane platit, takže ho přepiš i ve Zkratce.

## 5. Import výpisu z Raiffeisenbank

V internetovém bankovnictví otevři pohyby na účtu, nastav období a stáhni je jako CSV. V Kapse pak **Nastavení → Import výpisu → Vybrat soubor CSV**. Kapsa sama rozpozná sloupce a ukáže náhled; kdyby něco nesedělo, přepneš sloupec v nabídce.

Platby, které už Kapsa zná ze Zkratky nebo z pravidelných plateb, se podle částky a data spárují a nezdvojí. Opakovaný import stejného souboru nic nepřidá. Pohyby, které Kapsa neumí zařadit, skončí v sekci Ke kontrole.

## 6. Jak Kapsa počítá

**Výplata.** Když přijde, ťukni na Výplata přišla a zadej částku. Kapsa ji dopředu neodhaduje: dokud novou výplatu nezapíšeš, pracuje jen se zbytkem z minulého období. Zachytit ji sama neumí, protože zápis z Apple Pay spouští přiložení telefonu k terminálu, ne notifikace banky, a výplata přichází převodem. Výplata se zachytí i při importu CSV výpisu.

**Rozdělení.** Z výplaty se nejdřív odečtou pevné výdaje: všechny pravidelné výdaje v plánované výši (i když ještě neodešly) a platby v kategoriích označených jako pevné. Zbytek se rozdělí podle obálek v **Plán → Rozdělení**, výchozí je 20 % krátkodobé úspory, 30 % dlouhodobé investice a 50 % spotřeba. Obálky můžeš přejmenovat, změnit procenta nebo přidat vlastní; součet musí být 100 %.

**Pravidelné výdaje** nepotřebují datum. Kapsa s nimi počítá od začátku období a do pohybů je zapíše, až skutečně odejdou. Pozná je třemi způsoby:
- platba přes Apple Pay, jejíž obchodník obsahuje slovo z pole Pozná podle,
- řádek v importovaném CSV výpisu (podle slova nebo přesné částky),
- ťuknutí na Zaplaceno u výdaje na Přehledu; částku můžeš opravit, třeba u energií.

U plateb, které se strhávají samy v pevný den (předplatné z karty), zaškrtni Strhává se samo a zadej den. Ty se zapíšou automaticky.

**Zbytek spotřeby** se na konci období převádí do dalšího. Přečerpání se nepřevádí.

**Zůstatek na účtu** jednou opiš z bankovnictví (ťukni na dlaždici Na účtu). Kapsa k němu pak přičítá a odečítá všechno, co zapíše. Občas ho srovnej s bankou; rozdíl znamená, že nějaká platba v Kapse chybí.

**Odkládání.** U obálek na úspory Kapsa ukáže, kolik poslat stranou. Peníze převeď v bankovnictví a v Kapse ťukni na Označit jako odložené. Odložené peníze se nepočítají jako útrata.

**Denní limit** jsou peníze na spotřebu (včetně zbytku z minula) minus to, co jsi v období utratil mimo pevné výdaje, rozpočítané na zbývající dny včetně dneška.

**Limity kategorií** nastavíš buď jako procento ze spotřeby, nebo jako pevnou částku. Procenta se přizpůsobí výši výplaty.

**Tipy** připomenou neodložené peníze a nezaplacené pravidelné výdaje, upozorní na kategorii, ve které tímhle tempem přetáhneš limit, navrhnou úpravu limitů podle posledních měsíců, najdou časté drobné nákupy a opakované platby, které nemáš mezi pravidelnými. Návrhy limitů se dají přijmout jedním ťuknutím.

**Oznámení po platbě** ze Zkratky ukazuje stav kategorie a kolik ti ještě dnes zbývá, třeba „Potraviny: zbývá 2 880 Kč z 4 475 Kč. Dnes ještě 412 Kč.“

**Rozpočtové období** začíná dnem, který nastavíš v Nastavení. Nastav den, kdy ti obvykle chodí výplata.

## Účty

Kapsa vede pět účtů: běžný, spořicí, investiční, podnikatelský a bitcoin. Další přidáš na stránce Účty (na počítači v levém menu, na mobilu přes Spravovat účty na Přehledu).

- **Rozpočet, denní limit a tipy** počítají jen s běžným účtem. Výdaje na ostatních účtech se do nich nepromítnou.
- **Zůstatek** každého účtu jednou opiš z bankovnictví. Kapsa ho pak přepočítává podle pohybů. U investic a bitcoinu občas zadej aktuální hodnotu; když vyplníš i kolik jsi celkem vložil, Kapsa ukáže zisk nebo ztrátu a vklady i výběry do něj sama započítá.
- **Převody** mezi účty se nepočítají jako útrata ani příjem. Výjimka je převod na běžný účet z jiného účtu, který označíš jako příjem. Hodí se pro výběr z podnikání pro sebe a u převodu z podnikatelského účtu je to předvyplněné. Takový převod se rozdělí stejně jako výplata.
- **Obálky** z výplaty jsou propojené s účty (Plán → Rozdělení, pole Posílat na). Označit jako odložené tak rovnou zapíše převod na spořicí nebo investiční účet. Peníze ale musíš převést i v bance.
- **Bitcoin** se vede v BTC. Kurz v korunách se načítá z CoinGecko; když se nenačte, zadáš ho ručně v detailu účtu. U nákupu zadáš, kolik korun odešlo a kolik bitcoinu přišlo.
- **Karta v Peněžence:** u podnikatelského účtu vyplň název firemní karty, jak ho vidíš v Peněžence. Platby touto kartou pak Zkratka zapíše na podnikatelský účet, ne do osobního rozpočtu.

## 7. Úpravy a aktualizace

Pokud už máš databázi založenou ze starší verze, spusť `supabase/schema.sql` v SQL Editoru znovu. Skript jen doplní, co chybí, a existující data nechá být.

Když změníš soubory a nahraješ je znovu na GitHub, zvyš v `sw.js` číslo verze (`kapsa-v1` na `kapsa-v2`). Aplikace si pak stáhne nové soubory místo uložených.

Zálohu všech dat si stáhneš v Nastavení tlačítkem **Stáhnout zálohu**. Supabase navíc v administraci umí export tabulek do CSV.

## Přímé napojení na banku později

Raiffeisenbank má rozhraní Premium API, které se aktivuje certifikátem z internetového bankovnictví (Nastavení → Správa certifikátů). Pokud ho uvidíš i u svého osobního účtu, dá se Kapsa doplnit o automatické stahování všech pohybů. Vyžaduje to malou serverovou funkci, kterou jde provozovat zdarma, ale je to samostatný krok.
