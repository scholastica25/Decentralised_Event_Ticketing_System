;; Decentralized Event Ticketing System
;; Description: Smart contract for managing event tickets, sales, and revenue distribution

;; Error Codes
(define-constant ERR-NOT-AUTHORIZED (err u1))
(define-constant ERR-EVENT-NOT-FOUND (err u2))
(define-constant ERR-SOLD-OUT (err u3))
(define-constant ERR-TICKET-NOT-FOUND (err u4))
(define-constant ERR-INVALID-PRICE (err u5))
(define-constant ERR-EVENT-EXPIRED (err u6))
(define-constant ERR-INSUFFICIENT-FUNDS (err u7))
(define-constant ERR-ALREADY-EXISTS (err u8))
(define-constant ERR-TRANSFER-NOT-ALLOWED (err u9))
(define-constant ERR-TICKET-USED (err u10))
(define-constant ERR-REFUND-WINDOW-CLOSED (err u11))


;; Data Maps
(define-map Events
    { event-id: uint }
    {
        name: (string-utf8 100),
        description: (string-utf8 500),
        organizer: principal,
        venue: (string-utf8 100),
        date: uint,
        total-tickets: uint,
        tickets-sold: uint,
        ticket-price: uint,
        is-active: bool,
        refund-window: uint,
        revenue: uint,
        category: (string-utf8 50)
    }
)

(define-map Tickets
    { ticket-id: uint }
    {
        event-id: uint,
        owner: principal,
        purchase-price: uint,
        purchase-date: uint,
        is-used: bool,
        is-refunded: bool,
        seat-number: (optional uint)
    }
)

(define-map EventTickets
    { event-id: uint }
    { ticket-ids: (list 1000 uint) }
)

(define-map UserTickets
    { user: principal }
    { owned-tickets: (list 1000 uint) }
)

(define-map OrganizerRevenue
    { organizer: principal }
    {
        total-revenue: uint,
        pending-withdrawals: uint,
        events-organized: uint
    }
)

;; Data Variables
(define-data-var contract-owner principal tx-sender)
(define-data-var next-event-id uint u1)
(define-data-var next-ticket-id uint u1)
(define-data-var platform-fee-percent uint u5)
(define-data-var min-ticket-price uint u1000000) ;; in microSTX
(define-data-var max-refund-window uint u1209600) ;; 14 days in blocks


;; Read-Only Functions
(define-read-only (get-event (event-id uint))
    (map-get? Events { event-id: event-id })
)

(define-read-only (get-ticket (ticket-id uint))
    (map-get? Tickets { ticket-id: ticket-id })
)

(define-read-only (get-user-tickets (user principal))
    (map-get? UserTickets { user: user })
)

(define-read-only (get-organizer-revenue (organizer principal))
    (map-get? OrganizerRevenue { organizer: organizer })
)

(define-read-only (calculate-platform-fee (amount uint))
    (/ (* amount (var-get platform-fee-percent)) u100)
)

;; Event Management Functions
(define-public (create-event
    (name (string-utf8 100))
    (description (string-utf8 500))
    (venue (string-utf8 100))
    (date uint)
    (total-tickets uint)
    (ticket-price uint)
    (refund-window uint)
    (category (string-utf8 50))
)
    (let
        ((event-id (var-get next-event-id))
         (caller tx-sender))
        
        ;; Validate inputs
        (asserts! (>= ticket-price (var-get min-ticket-price)) ERR-INVALID-PRICE)
        (asserts! (<= refund-window (var-get max-refund-window)) ERR-INVALID-PRICE)
        (asserts! (> date block-height) ERR-EVENT-EXPIRED)
        
        (ok (begin
            ;; Create event
            (map-set Events
                { event-id: event-id }
                {
                    name: name,
                    description: description,
                    organizer: caller,
                    venue: venue,
                    date: date,
                    total-tickets: total-tickets,
                    tickets-sold: u0,
                    ticket-price: ticket-price,
                    is-active: true,
                    refund-window: refund-window,
                    revenue: u0,
                    category: category
                }
            )
            
            ;; Initialize event tickets
            (map-set EventTickets
                { event-id: event-id }
                { ticket-ids: (list) }
            )
            
            ;; Update organizer data
            (match (get-organizer-revenue caller)
                prev-data (map-set OrganizerRevenue
                    { organizer: caller }
                    {
                        total-revenue: (get total-revenue prev-data),
                        pending-withdrawals: (get pending-withdrawals prev-data),
                        events-organized: (+ (get events-organized prev-data) u1)
                    }
                )
                (map-set OrganizerRevenue
                    { organizer: caller }
                    {
                        total-revenue: u0,
                        pending-withdrawals: u0,
                        events-organized: u1
                    }
                )
            )
            
            ;; Increment event counter
            (var-set next-event-id (+ event-id u1))
        ))
    )
)



