const FeedParser = require('feedparser')
const request = require('request')
const uniq = require('uniq')
const dayjs = require('dayjs')

const oideyoList = [
  {
    themeId: 'oimchd',
    themeName: 'おいでよ町田',
    rssList: [
      {
        name: '町田市役所',
        url: 'http://www.city.machida.tokyo.jp/rss_news.xml',
        tag: 'city'
      },
      {
        name: '町田イベント',
        url:
          'https://www.google.co.jp/alerts/feeds/03126527126696341489/12080350212799317987',
        tag: 'event'
      }
    ]
  },
  {
    themeId: 'oisgmhr',
    themeName: 'おいでよ相模原',
    rssList: [
      {
        name: '相模原市役所',
        url: 'http://www.city.sagamihara.kanagawa.jp/rss.rss',
        tag: 'city'
      },
      {
        name: '相模原メシ',
        url:
          'https://www.google.co.jp/alerts/feeds/03126527126696341489/15212364454858267728',
        tag: 'food'
      }
    ]
  }
]

exports.fetchRss = (db, funcReq, funcRes) => {
  const batch = db.batch()
  const items = []

  const setBatch = oideyo => {
    return new Promise(resolve => {
      try {
        console.log('setBatch: ', oideyo.themeId, oideyo.themeName)
        for (
          let listIndex = 0;
          listIndex < oideyo.rssList.length;
          listIndex++
        ) {
          const req = request(rss.url)
          const feedparser = new FeedParser()

          // On Request Error
          req.on('error', error => {
            console.log('request error', error)
          })

          req.on('response', function(res) {
            const stream = this
            if (res.statusCode !== 200) {
              req.emit('error', new Error('Bad status code'))
            } else {
              stream.pipe(feedparser)
            }
          })

          // On handle Error
          feedparser.on('error', error => {
            console.log('handle error', error)
          })

          feedparser.on('meta', meta => {
            console.log('==== %s ====', meta.title)
          })

          feedparser.on('readable', function() {
            let item = this.read()
            if (item !== null) {
              items.push(item)
            } else {
              console.log('items: count == 0')
            }
          })

          feedparser.on('end', function() {
            // 既存postsから同RSSの最新の1件を取得
            const lastData = db
              .collection('posts')
              .where('url', '==', rss.url)
              .orderBy('date', 'desc')
              .limit(1)

            // 今回取得したRSSからN件までが最新であるかを調べる
            let limit = items.length - 1
            if (lastData.date) {
              for (limit; limit <= items.length; limit++) {
                if (items[limit].date <= lastData.date) {
                  //limit = 0である場合はset対象が存在しないため後続処理は不要
                  if (limit === 0) {
                    limit = -1
                  }
                  break
                }
              }
            }
            if (limit >= 0) {
              // firestoreへのbatchでのset上限が500件であるため各RSSのlimitは最新20件迄とする
              if (limit >= 20) {
                limit = 19
              }
              console.log('items: set count == ', limit + 1)
              for (let i = limit; i === 0; i--) {
                item = items[i]
                let uniqId = uniq()
                const title = item.title
                const url = item.link
                const date = item.date
                const imgUrl = item.image.url
                const postData = {
                  id: `${3000000000 + dayjs().unix()}-${uniqId}`,
                  title: title,
                  url: url,
                  date: date,
                  tag: rss.tag,
                  img_url: imgUrl,
                  themeId: oideyo.themeId,
                  themeName: oideyo.themeName,
                  createdAt: 3000000000 + dayjs().unix()
                }
                batch.set(db.collection('posts'), postData)
              }
            }
          })
        }
        return resolve
      } catch (e) {
        console.log(e)
        return new Error()
      }
    })
  }

  const doBatch = () => {
    console.log('doBatch')
    batch
      .commit()
      .then(() => {
        return funcRes.status(200).send('OK')
      })
      .catch(() => {
        return new Error()
      })
  }

  Promise.all(
    oideyoList.map(obj => {
      return setBatch(obj)
    })
  )
    .then(() => {
      return doBatch()
    })
    .catch(err => {
      return funcRes.status(500).send('Error adding document:', err)
    })
}