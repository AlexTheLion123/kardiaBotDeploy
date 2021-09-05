const Telegraf = require('telegraf');
const bot = new Telegraf(process.env.BOT_TOKEN);

const PORT = process.env.PORT || 3000;
const HEROKU_URL = process.env.HEROKU_URL; 

const axios = require(`axios`);
const fetch = require('node-fetch');

const apiurl = process.env.TOKEN_API;
const apiLPurl = process.env.LP_API;
    
const QuickChart = require(`quickchart-js`);
const whitelist = [1783394599, 845055796, 441474956]; // for users to send without being deleted
const groupWhitelist = [-1001543285342, -414304361]; //1 - kardiainfo chat, 2 - bottest test
let chartlink;
const DELAY = 300000;
let replyMessage;

const _telegrafRateLimiter = require("@riddea/telegraf-rate-limiter");
SHORT_TERM_LIMIT = 2; // 2 charts per 10 seconds
SHORT_TERM_MUTE = 10;//seconds
MID_TERM_LIMIT = 3; // 3 charts per minute
MID_TERM_MUTE = 60; 
LONG_TERM_LIMIT = 10; // 10 charts per hour
LONG_TERM_MUTE = 3600;//seconds
const short_term_rateLimiter = new _telegrafRateLimiter.RateLimiter(SHORT_TERM_LIMIT, SHORT_TERM_MUTE*1000);
const mid_term_rateLimiter = new _telegrafRateLimiter.RateLimiter(MID_TERM_LIMIT, MID_TERM_MUTE*1000);
const long_term_rateLimiter = new _telegrafRateLimiter.RateLimiter(LONG_TERM_LIMIT, LONG_TERM_MUTE*1000);
//const rateLimiter = new RateLimiter(1,2000) // e.g. each user can only send 1 message per 2 seconds

let lowerCaseCoinlist = [];
let upperCaseCoinlist = [];
let topTenArray = [];
let coinlist = [];
let lpList = []; // Array of all lp names
let lpData = []; // Array of objects containing all the LP data (keyboard)
let coinKeyboard = []; // array of objects for keyboard of coins
let topTenSymbols = [];
const COMMAND_BREAKDOWN =
`
Here is the breakdown of commands that I support:
/price symbol - get the price of the specified token. E.g. /price beco
/list, /info - get a list of the top ten KRC tokens by tvl
/help - a breakdown of all the bot commands
/menu - show the main menu
/now, /summary - show the price summary for the top ten KRC tokens
/lps - show the available LP pairs on kaidex 
`

const HELP_MESSAGE = 
`
${COMMAND_BREAKDOWN}
To show the chart for a token, just find the token in the menu or send a message with the token name as a single word. Try it, type in 'kai'
`

bot.command(["start","menu"], async (ctx) => {
    return mainMenu(ctx);
});

bot.hears("Back to Menu", async ctx => {
    return mainMenu(ctx);
})

bot.command("help", async ctx=> {
    return ctx.reply(HELP_MESSAGE, {reply_to_message_id: ctx.message.message_id})
})

bot.hears(["Help","help","HELP"], async ctx=> {
    return ctx.reply(HELP_MESSAGE, {reply_to_message_id: ctx.message.message_id})
})

// bot.command(["IFO","ifo"], async ctx => {
//     return showIFO(ctx);
// })

// bot.hears(["IFO","ifo"], async ctx => {
//     return showIFO(ctx);
// })

bot.on('text', async (ctx, next) => {   
    const input = ctx.message.text.split(" ");
    if(input.length==1){
        const temp_index = upperCaseCoinlist.indexOf(input[0].toUpperCase());
        if(temp_index >= 0){
            return output(coinlist[temp_index], ctx);
        }
    }

    return next();
})

bot.on('new_chat_members', async ctx => {
    const WELCOME_MESSAGE = 
`
🚀 Welcome #${ctx.from.first_name} to ${ctx.chat.title}. I am the #KardiaInfo bot and my aim to keep you up to date with the latest information regarding Kardiachain.
${COMMAND_BREAKDOWN}
`
    if(groupWhitelist.includes(ctx.chat.id)){
        return ctx.reply(WELCOME_MESSAGE, {parse_mode: 'markdown'})
    }
})

// optional: to disable private chat functionality
// bot.on("message", (ctx, next) => {
//     //disable private chat

//     if(ctx.chat.type == "private"){
//         return ctx.reply("This bot does not support private messaging, please use me in a group environment");
        
//     }

//     next();
// });

fetch(apiurl)
    .then((res) => { 
        return res.json();
    })
    .then((jsonData) => {
        jsonData.tokens.sort(compareTvl);
        jsonData.tokens.reverse();

        // for the info command, doesn't need to fetch list of top ten each time, only when prices included does it fetch each time
        tokenData = jsonData.tokens;
        topTenArray = tokenData.slice(0,10);
        topTenSymbols = topTenArray.map(item => item.symbol); 

        coinlist = jsonData.tokens.map(item => item.symbol) // uses same reference as tokenData
        getUpperCaseCoinlist(coinlist);


        //replace LTD
        let index = coinlist.indexOf("LTD Token");
        if (index !== -1) {
            coinlist[index] = "LTD";
        }

        coinKeyboard = getKeyboardData(coinlist);
        return coinKeyboard;
    })
    .then(res => {
        res.push([{"text": "Back to Menu"}])

        getLowerCaseCoinlist(coinlist);
        
        bot.hears("Tokens", this.displayKeyboard.apply(this, res, `*Click on a Token*`))
        
        bot.hears(coinlist, async (ctx) =>{   
            return output(ctx.message.text, ctx);   
        })

        bot.hears(lowerCaseCoinlist, async (ctx) => {
            return output(transformInput(ctx.message.text), ctx);
        })    

        bot.command(["price","p"], getPriceCommandOutput)

        bot.command(["list", "info"], async ctx => {
            let strCoinList = "🏦 The #list of the top 10 coins by tvl is shown below. Use the */price* command to display the information for a specific coin.\nE.g. /price kai\n";
            for(let i=0; i<topTenSymbols.length; i++){
                strCoinList = strCoinList + `\n${topTenSymbols[i]}`
            }
            return ctx.reply(strCoinList, {reply_to_message_id: ctx.message.message_id, parse_mode: 'markdown'})
        })

        
    })
    .then(() => {
        //Listen to show LP keyboard
        onLpCommand();
    })
    .then(() => {
        bot.command(["now","summary"], showTopTenPrices)

        bot.hears(["Summary", "summary", "now", "all", "prices", "Prices", "Now", "All"], showTopTenPrices)
    })


//start of functions
async function getPriceCommandOutput(ctx){
    const input = ctx.message.text.split(" ");
    let input_coin = "";
    
    if(input.length > 1){
        input_coin = transformInput(input[1]);
    } else { // if only types '/price'
        return ctx.reply("⚠️ Please type a valid coin name after the /price command. Type /list or /start to see the supported coins on Kardiachain\nE.g. /price beco", {reply_to_message_id: ctx.message.message_id})
    }
    
    if(input.length > 1 && coinlist.includes(input_coin)){ //types price and coin is valid
        return output(input_coin, ctx);
    } else if(input.length > 1 && !coinlist.includes(input_coin)){
        const initial_char = input_coin.charAt(0).toUpperCase(); 
        const suggestions = coinlist.filter(item => item.charAt(0) == initial_char);

        //branch 1: types price command and coin but coin is not valid, but first letter matches
        if(suggestions.length > 0){ 
            let temp_str = "⚠️ Did you mean: ";
            for(let i=0; i<suggestions.length; i++){
                temp_str = temp_str + `\n${suggestions[i]}`;
            }
            return ctx.reply(temp_str, {reply_to_message_id: ctx.message.message_id});
        //branch 2: types price command and coin but coin is not valid, and first letter does not match.
        } else {
            return ctx.reply("⚠️ Please type a valid coin name after the /price command. Type /list or /start to see the supported coins on Kardiachain\nE.g. /price beco", {reply_to_message_id: ctx.message.message_id})
        }
    }
}

function getLowerCaseCoinlist(coinlist){
    for(i=0;i<coinlist.length; i++){ //also allow user to type in lower case
        lowerCaseCoinlist.push(coinlist[i].toLowerCase());
    }
};

async function showIFO(ctx){
    return ctx.reply("Follow the link to find out more about the IFO with KardiaInfo", 
        {
            reply_to_message_id: ctx.message.message_id,
            reply_markup: {
                inline_keyboard:[
                    [
                        {text: 'IFO Details', url: 'kardiainfo.com/ifo'}
                    ]
                ]
            }
            
    })
}


function getUpperCaseCoinlist(coinlist){
    for(let i=0; i<coinlist.length; i++){
        upperCaseCoinlist.push(coinlist[i].toUpperCase());
    }
}

function transformInput(input) {
    const temp_index = upperCaseCoinlist.indexOf(input.toUpperCase());
    if(temp_index >= 0){
        return coinlist[temp_index];
    }
    return input;
}

async function mainMenu(ctx){
    return await ctx.reply(`Hello, I am the KardiaInfo bot, click on a button`, 
        {   
            parse_mode: 'markdown',
            reply_to_message_id: ctx.message.message_id,
            reply_markup: {
                keyboard: [
                    [{"text": "Tokens"}],
                    [{"text": "LP"}],
                    [{"text": "Summary"}],
                    [{"text": "Help"}]
                ],
                resize_keyboard: true,
                one_time_keyboard: true,
                selective: true
            }
        })
}

async function showTopTenPrices(ctx){
    if(checkRateLimited(ctx)){
        return;
    }

    await fetch(apiurl)
        .then((res) => { 
            return res.json();
        })
        .then((jsonData) => {
            tokenData = jsonData.tokens;

            const kaidataTopTen = tokenData.filter(item => item.symbol=='KAI');   
            const kaipriceTopTen = kaidataTopTen[0].price;

            tokenData.sort(compareTvl);
            tokenData.reverse();
            topTenArray = tokenData.slice(0,10);
            const topTenPrice = topTenArray.map(item => item.price);
            const topTenSymbols = topTenArray.map(item => item.symbol);
            let priceInKai = [];

            for(let i=0; i<topTenArray.length; i++){
                if(topTenSymbols[i].includes("LTD")){
                    topTenSymbols[i] = "LTD";
                }
                if(topTenSymbols[i] == `BossDoge` | topTenSymbols[i] == `VNDT` | topTenSymbols[i] == `VNDC`){
                    topTenPrice[i] = parseFloat(topTenPrice[i], 2).toPrecision(3);
                    priceInKai.push(parseFloat(topTenPrice[i]/kaipriceTopTen, 2).toPrecision(3));
                } else {
                    topTenPrice[i] = numberWithCommas(Math.round(topTenPrice[i] * 10000)/10000);
                    priceInKai.push(numberWithCommas(Math.round(topTenPrice[i]/kaipriceTopTen * 10000) / 10000));
                } 
            }
            
            const spacedSymbols = getHTMLTable(topTenSymbols);
            const spacedPrices = getHTMLTable(topTenPrice)
            
            let topTenMessage = "<pre>\n";
            for(let i=0; i<spacedSymbols.length; i++){
                topTenMessage += spacedSymbols[i] + `|\t\t$${spacedPrices[i]}\n`;
            }
            topTenMessage += "</pre>"
            return ctx.reply(topTenMessage, 
                {
                    reply_to_message_id: ctx.message.message_id, 
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard:[
                            [
                                {text: 'Get more Token Info', url: 'http://kardiainfo.com/tokens'}
                            ]
                        ]
                    }
                });
            
    })
}

function getHTMLTable(arr){
    //get longest symbol
    let maxLength = 0;
    for(let i=0; i<arr.length; i++){
        if(arr[i].length > maxLength){
            maxLength = arr[i].length;
        }
    }

    let newArr = [];
    for(let i=0; i<arr.length; i++){
        let tempStr = arr[i];
        for(let j=0; j<(maxLength-arr[i].length+2); j++){
            tempStr += `\t`;
        }
        newArr.push(tempStr);
    }
    return newArr;
}

function compareTvl(a,b){ //used to sort 
    if(a.tvl < b.tvl){
        return -1;
    }
    if(a.tvl > b.tvl){
        return 1;
    }
    return 0;
}

async function onLpCommand(){ 
    await axios.get(apiLPurl)
        .then(res => { // get array of objects
            lpData = res.data.lps;
            return lpData;
        })
        .then(res => { // get names of each lp
            return res.map(item => item.name)
        })
        .then(res => { // get length 
            for(let i=0; i<res.length; i++){
                lpList[i] = res[i].slice(0, -3);
            }
            return lpList;
        })
        .then(res => {
            lpKeyboardData = getKeyboardData(res);
            lpKeyboardData.push([{"text": "Back to Menu"}])

            //displayKeyboard(ctx, lpKeyboardData, `*Click on an LP*`)
            return lpList
        })
        .then(res => {
            bot.command(["lp", "lps","LP", "LPS", "LPs", "Lp", "Lps"], async ctx => {
                return displayKeyboard(ctx, lpKeyboardData, `*Click on an LP*`)
            })

            bot.hears(["LP", "lp", "lps", "Lp", "Lps"], async ctx => {
                return displayKeyboard(ctx, lpKeyboardData, `*Click on an LP*`)
            })

            bot.hears(lpList, async ctx => {
                if(checkRateLimited(ctx)){
                    return;
                }
                let input = ctx.message.text;
                
                //find specified LP data
                const lpIndex = lpList.indexOf(input);
                const lpPrice = numberWithCommas(Math.round(lpData[lpIndex].price * 10000)/10000);
                const lptvl = numberWithCommas(Math.round(lpData[lpIndex].tvl));
                const lpSupply = numberWithCommas(Math.round(lpData[lpIndex].supply * 100)/100)
                let lpReplyMessage = 
                `Price: *$${lpPrice}* \nTVL: *$${lptvl}* \nSupply: *${lpSupply}*`;
                
                return ctx.reply(lpReplyMessage, 
                    {
                        reply_to_message_id: ctx.message.message_id, 
                        parse_mode: "markdown",
                        reply_markup: {
                            inline_keyboard:[
                                [
                                    {text: 'Get more LP Info', url: 'http://kardiainfo.com/lps'}
                                ]
                            ]
                        }
                    });
            })
        }) //end of last then
} // end of lp function

function getKeyboardData(coinlist) { //each row of buttons will have 3 columns
    let keyboardData = [];
    let i = 0;
    while(coinlist.length - i > 0) {
        
        if(coinlist.length-i>=3){
                keyboardData.push([{text: coinlist[i]}, {text:coinlist[i+1]}, {text:coinlist[i+2]}])
            i = i+3;
            continue;
        } else if(coinlist.length-i==2) {
                keyboardData.push([{text: coinlist[i]}, {text:coinlist[i+1]}])
            i = i+2;
            continue;
        } else if(coinlist.length-i==1) {
            keyboardData.push([{text:coinlist[i]}])
            i = i+1;
            continue;
        }
    }
    return keyboardData;
}

async function displayKeyboard(ctx, keyboardData, message){
    return await ctx.reply(message, 
        {   
            parse_mode: 'markdown',
            reply_to_message_id: ctx.message.message_id,
            reply_markup: {
                keyboard: keyboardData,
                resize_keyboard: true,
                one_time_keyboard: true,
                selective: true
            }
        })
            
}

async function output(name, ctx){
    isLimited = checkRateLimited(ctx);
    if(isLimited){
        return;
    }
    
    let sender_id = ctx.from.id
    
    if(name=="LTD"){
        name = "LTD Token"
    }
    if(name=="KEPHI"){
        name = "KPHI"
    }
    
    await fetch(apiurl)
        .then((res) => {
            return res.json()
        })
        .then(res => {
            kaidata = res.tokens.filter(item => item.symbol=='KAI');   
            kaiVals = kaidata[0].histData.slice(1,25);
            kaiVals.reverse(); //data is backwards
            

            if(name != `KAI`){
                coindata = res.tokens.filter(item => item.symbol==name);
                
                kaiprice = kaidata[0].price;

                if(name == `BossDoge` | name == `VNDT` | name == `VNDC`){
                    priceusd = parseFloat(coindata[0].price, 2).toPrecision(3);
                    pricekai = parseFloat(priceusd/kaiprice, 2).toPrecision(3);
                } else {
                    priceusd = Math.round(coindata[0].price * 10000)/10000;
                    pricekai = Math.round(priceusd/kaiprice * 10000)/10000;
                }
                
                dayChange = Math.round(coindata[0].dayChange * 10000)/10000;
                tvl = Math.round(coindata[0].tvl);
                mcap = Math.round(coindata[0].mcap);
                supply = numberWithCommas(Math.round(coindata[0].supply))
                
                //add commas
                priceusd = numberWithCommas(priceusd);
                pricekai = numberWithCommas(pricekai);
                tvl = numberWithCommas(tvl);
                mcap = numberWithCommas(mcap);
                
                replyMessage = `Price USD: *\$${priceusd}*\nDaily Change: *${dayChange}%*\nPrice KAI: *${pricekai} KAI*\nTotal Supply: *${supply}*\nMarket Cap: *$${mcap}*\nTVL: *$${tvl}*` 

                usdVals = coindata[0].histData.slice(1,25);
                usdVals.reverse();
                
                //if new coin, chart cannot be plotted
                if(usdVals.length<24){
                    ctx.reply(`Not enough historical data to construct a chart for *${name}*. Coin hasn't been live for 24 hours yet.\n\n${replyMessage}`, {reply_to_message_id: ctx.message.message_id, parse_mode: "markdown"})
                    return
                }

                chartdata = usdVals.map(function(n, i) { return n / kaiVals[i]; });
                chartlink = getchart2(chartdata, name)
                

            } else {
                kaiprice = numberWithCommas(Math.round(kaidata[0].price * 10000)/10000);
                dayChange = numberWithCommas(Math.round(kaidata[0].dayChange * 100)/100);
                tvl = numberWithCommas(Math.round(kaidata[0].tvl));
                mcap = numberWithCommas(Math.round(kaidata[0].mcap));
                supply = numberWithCommas(Math.round(kaidata[0].supply))
                
                replyMessage = `\nPrice USD: *$${kaiprice}*\nDaily Change: *${dayChange}%*\nTotal Supply: *${supply}*\nMarket Cap: *$${mcap}*\nTVL: *$${tvl}*`  

                chartlink = getchart2(kaiVals, name);
                //return(message_id);
            }
        
            return chartlink;
        })
        .then(async res=>{    
            return await ctx.replyWithPhoto(res, 
                {   
                    reply_to_message_id: ctx.message.message_id,
                    caption: replyMessage,
                    parse_mode: "markdown",
                    reply_markup: {
                        inline_keyboard:[
                            [
                                {text: `Get more ${name} Info`, url: `kardiainfo.com/tokens/${name.replace(/\s+/g, '_')}`}
                            ]
                        ]
                    }
                })
        })//end of fetch .then
}            

function checkRateLimited(ctx){
    if(whitelist.includes(ctx.from.id)){
        return false;
    }
    
    const short_term_limited = short_term_rateLimiter.take(ctx.from.id);
    const short_term_uses = short_term_rateLimiter.limiters[ctx.from.id].tokensThisInterval

    const mid_term_limited = mid_term_rateLimiter.take(ctx.from.id);
    const mid_term_uses = mid_term_rateLimiter.limiters[ctx.from.id].tokensThisInterval

    const long_term_limited = long_term_rateLimiter.take(ctx.from.id);
    const long_term_uses = long_term_rateLimiter.limiters[ctx.from.id].tokensThisInterval
    
    //give warning to user (only for long term limit)
    // if(long_term_uses == (LONG_TERM_LIMIT-3)){
    //     ctx.reply(`⚠️ *#Warning ${ctx.from.first_name}* ⚠️\nYou have been flagged for #excessive usage. You will be #muted for ${LONG_TERM_MUTE} seconds if you continue without pause.`, 
    //     {
    //         reply_to_message_id: ctx.message.message_id,
    //         parse_mode: "markdown"
    //     })
    // }

    if (short_term_uses == SHORT_TERM_LIMIT) {
        return ctx.deleteMessage()
        return true;
        
        if(ctx.chat.type != "supergroup"){
            //ctx.reply(`Please calm down ${ctx.from.first_name}!`)
            return ctx.deleteMessage()
            return true
        }
        // ctx.reply(`${ctx.from.username} has been temporarily #muted for ${SHORT_TERM_MUTE} seconds`, 
        //     {
        //         parse_mode: "markdown",
        //         //reply_to_message_id: ctx.message.message_id
        //     })
        bot.telegram.restrictChatMember(ctx.chat.id, ctx.from.id, 
            {can_send_messages: false,until_date: Date.now() + SHORT_TERM_MUTE})    
        
        return true
    }

    if (mid_term_uses == MID_TERM_LIMIT) {
        return ctx.deleteMessage()
        return true;
        
        if(ctx.chat.type != "supergroup"){
            //ctx.reply(`Please calm down ${ctx.from.first_name}!`)
            return ctx.deleteMessage()
            return true
        }
        // ctx.reply(`${ctx.from.username} has been temporarily #muted for ${SHORT_TERM_MUTE} seconds`, 
        //     {
        //         parse_mode: "markdown",
        //         //reply_to_message_id: ctx.message.message_id
        //     })
        bot.telegram.restrictChatMember(ctx.chat.id, ctx.from.id, 
            {can_send_messages: false,until_date: Date.now() + MID_TERM_MUTE})    
        
        return true
    }

    if (long_term_uses == LONG_TERM_LIMIT) {
        return ctx.deleteMessage()
        return true;
        
        if(ctx.chat.type != "supergroup"){
            return ctx.deleteMessage()
            return true
        }
        ctx.reply(`${ctx.from.username} has been temporarily #muted for ${LONG_TERM_MUTE} seconds`, 
            {
                parse_mode: "markdown",
                //reply_to_message_id: ctx.message.message_id
            })
        bot.telegram.restrictChatMember(ctx.chat.id, ctx.from.id, 
            {can_send_messages: false,until_date: Date.now() + LONG_TERM_MUTE})    
        
        return true
    }

    return false
}


function numberWithCommas(x) {
    x = x.toString();
    arr = x.split(".");
    if(arr[0].length > 3){
        arr[0] = arr[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    x = arr.join(".")
    return x
}

// //----------------------------------------------------trying to make chart look better below
function getchart2(chartdata, coinname){
    let chartCurrency = ""
    if(coinname == 'KAI'){
        chartCurrency = "USD";
    } else {
        chartCurrency = "KAI";
    }

    const chart = new QuickChart();

    chart.setWidth(500)
    chart.setHeight(300);
    chart.setBackgroundColor("black");

    chart.setConfig({
        type: 'line',
        data: {
            labels: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],
            datasets: [{
                data: chartdata,
                fill: false,
                borderColor: QuickChart.getGradientFillHelper('vertical', ['#eb3639', '#a336eb', '#36a2eb']),
                borderWidth: 5,
                pointRadius: 0,
            }]
        },
        options: {
            legend: {
                display: false
            },
            scales: {
                xAxes: [{
                    display: false,
                        gridLines: {
                            display: "false",
                            //color: "grey"
                        },
                }],
                yAxes: [{
                    display: true,
                        gridLines: {
                            display: "false",
                            //color: "grey"
                        },
                }]
            },
            // plugins: {
            //     backgroundImageUrl: 'https://cdn.pixabay.com/photo/2017/08/30/01/05/milky-way-2695569__340.jpg',
            // }
            title: {
              display: true,
              text: `24H Price Chart in ${chartCurrency}`,
            }
        },
        
    });

    // Print the chart URL
    url = chart.getUrl();
    return(url);
}
// //-----------------------------------------------------------------------------------above

bot.launch({
    webhook: {
        domain: HEROKU_URL,
        port: PORT
    }
})