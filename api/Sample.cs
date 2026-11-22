using System.Text.Json.Nodes;

namespace Plinth;

/// Adds a made-up project so there is something to look at: npm run sample
public static class Sample
{
    public static void Add()
    {
        var p = Store.Create(JsonNode.Parse("""
            { "name": "Neem Court", "developer": "Sample Estates", "tagline": "Shade, space and a slower evening",
              "type": "apartments", "stage": "prelaunch", "possession": "December 2029", "land": "4.2 acres", "units": "312",
              "rera": "SAMPLE/0000/2026", "locality": "Baner", "city": "Pune", "address": "Sample Road, Baner, Pune",
              "phone": "+91 00000 00000", "email": "hello@example.com", "website": "example.com",
              "priceFrom": "₹1.18 Cr*", "offer": "Pre-launch price for the first 50 bookings",
              "configs": [ { "type": "2 BHK", "size": "780 sq ft", "price": "₹1.18 Cr*" }, { "type": "3 BHK", "size": "1,120 sq ft", "price": "₹1.64 Cr*" }, { "type": "4 BHK", "size": "1,560 sq ft", "price": "₹2.35 Cr*" } ],
              "connectivity": [ { "place": "Metro station", "time": "6 mins" }, { "place": "IT park", "time": "15 mins" }, { "place": "Expressway", "time": "10 mins" } ],
              "amenities": [ "Swimming pool", "Clubhouse", "Landscaped gardens", "Jogging track", "Yoga deck", "Co-working lounge" ],
              "building": { "towers": 3, "floors": 22, "style": "green", "wall": "#EDE7DA", "trim": "#6A5140", "setting": "hills", "pool": true, "podium": true } }
            """)!.AsObject());
        Console.WriteLine($"Added {p.Str("name")} {p.Str("id")}");
    }
}
